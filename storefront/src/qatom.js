// Qatom master-MCP client for the storefront Worker.
// Auth: OAuth refresh tokens from pay.m.todaq.net (offline_access). Qatom rotates the
// refresh token on every use and treats reuse of an old one as theft (it revokes the
// whole sign-in), so every refresh goes through ONE Durable Object (TokenManager), which
// runs them strictly one at a time and keeps the current token in its own storage.
// A static QATOM_MCP_TOKEN is used only if no refresh token is configured.

const MCP_URL = "https://mcp.m.todaq.net/mcp";
const TOKEN_URL = "https://pay.m.todaq.net/v4/oidc/token";
const RESOURCE = "https://mcp.m.todaq.net";
const PROTOCOL = "2025-06-18";
const SIGN_IN_AGAIN = "Run `node scripts/get-token.mjs --apply` in the storefront folder to sign the storefront in to Qatom again.";

export class QatomError extends Error {
  constructor(message, { status = 502, code = "upstream" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- tokens: Durable Object ----------

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function refreshWith(env, refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.QATOM_CLIENT_ID,
    resource: RESOURCE,
  });
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (env.QATOM_CLIENT_SECRET) {
    headers.authorization = "Basic " + btoa(`${encodeURIComponent(env.QATOM_CLIENT_ID)}:${encodeURIComponent(env.QATOM_CLIENT_SECRET)}`);
  }
  const res = await fetch(TOKEN_URL, { method: "POST", headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = `${data.error || ""} ${String(data.error_description || "").slice(0, 200)}`.trim();
    if (data.error === "invalid_grant") {
      throw new QatomError(`Qatom sign-in expired or was revoked (HTTP ${res.status} ${detail}). ${SIGN_IN_AGAIN}`, { status: 503, code: "signin_required" });
    }
    throw new QatomError(`token refresh failed: HTTP ${res.status} ${detail}`.trim(), { status: 503, code: data.error || "refresh_failed" });
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // rotated if the server issued a new one
    expires_at: Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000,
  };
}

export class TokenManager {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve(); // one refresh at a time, even across awaits
  }

  async fetch(request) {
    const { bad = null } = await request.json().catch(() => ({}));
    const run = this.queue.then(() => this.current(bad));
    this.queue = run.catch(() => {});
    try {
      const { access_token, expires_at } = await run;
      return Response.json({ access_token, expires_at });
    } catch (e) {
      return Response.json({ error: String(e.message || e), code: e.code || "refresh_failed" }, { status: 503 });
    }
  }

  async current(bad) {
    const env = this.env;
    let rec = await this.state.storage.get("rec"); // { access_token, refresh_token, expires_at, boot }
    // A new sign-in (a different QATOM_REFRESH_TOKEN secret) replaces whatever is stored.
    const boot = env.QATOM_REFRESH_TOKEN ? await sha256(env.QATOM_REFRESH_TOKEN) : null;
    if (boot && (!rec || rec.boot !== boot)) rec = { refresh_token: env.QATOM_REFRESH_TOKEN, boot };
    if (!rec?.refresh_token) throw new QatomError(`The storefront is not signed in to Qatom. ${SIGN_IN_AGAIN}`, { status: 503, code: "not_configured" });

    // Reuse the current access token unless it expired or the caller just saw it rejected.
    if (rec.access_token && rec.expires_at > Date.now() && rec.access_token !== bad) return rec;

    const next = { ...(await refreshWith(env, rec.refresh_token)), boot: rec.boot };
    await this.state.storage.put("rec", next);
    return next;
  }
}

let memToken = null; // per-isolate cache: { access_token, expires_at }

async function getAccessToken(env, { bad = null } = {}) {
  if (!bad && memToken && memToken.expires_at > Date.now()) return memToken.access_token;
  if (!env.QATOM_REFRESH_TOKEN || !env.TOKEN_MANAGER) {
    if (env.QATOM_MCP_TOKEN) return env.QATOM_MCP_TOKEN;
    throw new QatomError(`The storefront is not signed in to Qatom. ${SIGN_IN_AGAIN}`, { status: 503, code: "not_configured" });
  }
  const stub = env.TOKEN_MANAGER.get(env.TOKEN_MANAGER.idFromName("qatom"));
  const res = await stub.fetch("https://token-manager/token", { method: "POST", body: JSON.stringify({ bad }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new QatomError(data.error || "token manager failed", { status: 503, code: data.code || "refresh_failed" });
  memToken = { access_token: data.access_token, expires_at: data.expires_at };
  return data.access_token;
}

// ---------- MCP transport ----------

let session = null; // { id, token } per isolate

async function readRpc(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) {
    let last = {};
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const m = JSON.parse(line.slice(5).trim());
        if (m.id !== undefined) return m;
        last = m;
      } catch {}
    }
    return last;
  }
  try { return text ? JSON.parse(text) : {}; } catch { throw new QatomError("unreadable MCP response"); }
}

function headers(token, sid) {
  const h = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  // The protocol version is negotiated in the initialize body; send the header only after it.
  if (sid) { h["mcp-session-id"] = sid; h["mcp-protocol-version"] = PROTOCOL; }
  return h;
}

async function openSession(token) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "qatom-storefront", version: "1.0" } },
    }),
  });
  if (res.status === 401) throw new QatomError("unauthorized", { status: 401, code: "unauthorized" });
  if (!res.ok) throw new QatomError(`MCP initialize: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
  const id = res.headers.get("mcp-session-id");
  const msg = await readRpc(res);
  if (msg.error) throw new QatomError(`initialize: ${msg.error.message || "error"}`);
  await fetch(MCP_URL, {
    method: "POST",
    headers: headers(token, id),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return { id, token };
}

async function rawCall(token, sid, name, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(token, sid),
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
  });
  if (res.status === 401) throw new QatomError("unauthorized", { status: 401, code: "unauthorized" });
  if (res.status === 404 || res.status === 400) throw new QatomError(`session ${res.status}`, { status: res.status, code: "session" });
  if (!res.ok) throw new QatomError(`MCP tools/call ${name}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
  return readRpc(res);
}

// Call a tool with up to one token refresh and one session reopen.
export async function callTool(env, name, args) {
  let forced = false;
  let bad = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await getAccessToken(env, { bad });
    try {
      if (!session || session.token !== token) session = await openSession(token);
      const msg = await rawCall(token, session.id, name, args);
      if (msg.error) throw new QatomError(msg.error.message || "tool error", { status: 502, code: "tool_error" });
      return parseToolResult(msg.result);
    } catch (e) {
      session = null;
      if (e.code === "unauthorized" && !forced) { forced = true; bad = token; memToken = null; continue; }
      if (e.code === "session" && attempt === 0) continue;
      throw e;
    }
  }
  throw new QatomError("Qatom did not respond");
}

function parseToolResult(result) {
  if (!result) throw new QatomError("empty tool result");
  const text = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (result.isError) throw new QatomError(text || "tool returned an error", { status: 422, code: "tool_rejected" });
  if (result.structuredContent) return result.structuredContent;
  try { return JSON.parse(text); } catch { return { text }; }
}

// ---------- catalog + checkout ----------

const CATALOG_TTL = 300; // seconds

export async function getCatalog(env, ctx, { fresh = false } = {}) {
  const cache = caches.default;
  const key = new Request("https://storefront.internal/catalog-v1");
  if (!fresh) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  // Page through the whole catalog (500 per call), however large it grows.
  const PAGE = 500, MAX_PAGES = 40;
  const items = [];
  const seen = new Set();
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await callTool(env, "catalog_search", { limit: PAGE, offset: page * PAGE });
    const batch = Array.isArray(data.items) ? data.items : [];
    total = Number(data.total ?? total);
    for (const it of batch) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    if (batch.length < PAGE || items.length >= total) break;
  }
  const out = { items, total: total || items.length, fetched_at: new Date().toISOString() };
  const resp = new Response(JSON.stringify(out), { headers: { "cache-control": `max-age=${CATALOG_TTL}` } });
  const put = cache.put(key, resp);
  if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  return out;
}

const CHECKOUT_RE = /^https:\/\/checkout\.m\.todaq\.net\/(checkout|cart)\/[A-Za-z0-9-]{8,64}$/;

export async function mintCheckout(env, catalog_item_id, args) {
  const params = { catalog_item_id };
  if (args && Object.keys(args).length) params.arguments = args;
  const data = await callTool(env, "guest_checkout", params);
  let url = data.checkout_url;
  if (!url && data.text) url = (data.text.match(/https:\/\/checkout\.m\.todaq\.net\/(checkout|cart)\/[A-Za-z0-9-]+/) || [])[0];
  // Only ever redirect to Qatom's own checkout host.
  if (!url || !CHECKOUT_RE.test(url)) throw new QatomError("no valid checkout link returned");
  return url;
}

// ---------- carts (Qatom cart_* tools; one cart_id per visitor) ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validCartId = (id) => typeof id === "string" && UUID.test(id);

export async function cartAdd(env, cartId, catalog_item_id, args, quantity = 1) {
  const p = { catalog_item_id, quantity };
  if (validCartId(cartId)) p.cart_id = cartId;
  if (args && Object.keys(args).length) p.arguments = args;
  return callTool(env, "cart_add_item", p);
}
export const cartView = (env, cart_id) => callTool(env, "cart_view", { cart_id });
export const cartRemove = (env, cart_id, line_id) => callTool(env, "cart_remove_item", { cart_id, line_id });
export const cartDiscard = (env, cart_id) => callTool(env, "cart_discard", { cart_id });

export async function cartCheckout(env, cart_id) {
  const data = await callTool(env, "cart_checkout", { cart_id });
  const url = data.checkout_url;
  if (!url || !CHECKOUT_RE.test(url)) throw new QatomError("no valid cart checkout link returned");
  return { url, total: Number(data.price ?? data.total ?? 0), data };
}

// test hook
export function _resetForTests() { memToken = null; session = null; }
