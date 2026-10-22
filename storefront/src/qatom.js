// Qatom master-MCP client for the storefront Worker.
// Auth: OAuth refresh-token flow against pay.m.todaq.net (offline_access), rotating
// tokens kept in KV. Falls back to a static QATOM_MCP_TOKEN if no refresh token is set.

const MCP_URL = "https://mcp.m.todaq.net/mcp";
const TOKEN_URL = "https://pay.m.todaq.net/v4/oidc/token";
const RESOURCE = "https://mcp.m.todaq.net";
const KV_KEY = "qatom-oauth";
const PROTOCOL = "2025-06-18";

export class QatomError extends Error {
  constructor(message, { status = 502, code = "upstream" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- tokens ----------

let memToken = null; // { access_token, expires_at } per isolate

async function loadStored(env) {
  if (!env.TOKENS) return null;
  try { return await env.TOKENS.get(KV_KEY, "json"); } catch { return null; }
}

async function saveStored(env, rec) {
  if (!env.TOKENS) return;
  await env.TOKENS.put(KV_KEY, JSON.stringify(rec));
}

async function refresh(env, refreshToken) {
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
    const err = new QatomError(`token refresh failed: HTTP ${res.status} ${data.error || ""} ${String(data.error_description || "").slice(0, 200)}`.trim(), { status: 503, code: data.error || "refresh_failed" });
    throw err;
  }
  return {
    access_token: data.access_token,
    // rotate if the server issued a new refresh token; otherwise keep the old one
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000,
  };
}

async function getAccessToken(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && memToken && memToken.expires_at > now) return memToken.access_token;

  const canRefresh = env.QATOM_CLIENT_ID && (env.QATOM_REFRESH_TOKEN || env.TOKENS);
  if (!canRefresh) {
    if (env.QATOM_MCP_TOKEN) return env.QATOM_MCP_TOKEN;
    throw new QatomError("storefront is not signed in to Qatom (no token configured)", { status: 503, code: "not_configured" });
  }

  let stored = await loadStored(env);
  if (!force && stored?.access_token && stored.expires_at > now) {
    memToken = stored;
    return stored.access_token;
  }

  const candidates = [stored?.refresh_token, env.QATOM_REFRESH_TOKEN].filter(Boolean);
  let lastErr;
  for (const rt of [...new Set(candidates)]) {
    try {
      const rec = await refresh(env, rt);
      await saveStored(env, rec);
      memToken = rec;
      return rec.access_token;
    } catch (e) {
      lastErr = e;
      // Another isolate may have rotated the token a moment ago: re-read once.
      const again = await loadStored(env);
      if (again?.access_token && again.expires_at > Date.now() && again.access_token !== stored?.access_token) {
        memToken = again;
        return again.access_token;
      }
    }
  }
  if (env.QATOM_MCP_TOKEN) return env.QATOM_MCP_TOKEN;
  throw lastErr || new QatomError("no refresh token stored on the Worker yet (QATOM_REFRESH_TOKEN)", { status: 503, code: "not_configured" });
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await getAccessToken(env, { force: forced });
    try {
      if (!session || session.token !== token) session = await openSession(token);
      const msg = await rawCall(token, session.id, name, args);
      if (msg.error) throw new QatomError(msg.error.message || "tool error", { status: 502, code: "tool_error" });
      return parseToolResult(msg.result);
    } catch (e) {
      session = null;
      if (e.code === "unauthorized" && !forced) { forced = true; memToken = null; continue; }
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
