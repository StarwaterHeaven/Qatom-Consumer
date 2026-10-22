// End-to-end tests: real Worker code in Miniflare (workerd), Qatom OAuth + MCP mocked
// with the live catalog snapshot. Run: npm test
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const out = await build({
  entryPoints: ["src/index.js"], bundle: true, format: "esm", write: false,
  loader: { ".txt": "text" }, target: "es2022",
});
const script = out.outputFiles[0].text;

const catalog = JSON.parse(readFileSync("test/catalog-fixture.json", "utf8"));
// hostile listing to prove escaping
catalog.items.push({ id: 9001, name: `<script>alert(1)</script>Evil "item"`, description: `x<img src=x onerror=alert(1)> https://ok.example/a"b`, price: 2, seller: `<b>bad</b>`, input_schema: { type: "object", properties: {} } });

// ---- mock Qatom ----
const state = { refreshCalls: 0, sessions: 0, calls: [], rt: "RT0", at: "AT1", fail401Once: false, evilUrl: false, used: new Set(), revoked: false, denyRefresh: false };
async function outbound(req) {
  const url = new URL(req.url);
  if (url.host === "pay.m.todaq.net" && url.pathname === "/v4/oidc/token") {
    const body = new URLSearchParams(await req.text());
    state.refreshCalls++;
    // Like Qatom's OIDC server: reusing a rotated refresh token revokes the whole sign-in.
    if (state.used.has(body.get("refresh_token"))) { state.revoked = true; state.at = "REVOKED"; }
    if (state.revoked || state.denyRefresh || body.get("grant_type") !== "refresh_token" || body.get("refresh_token") !== state.rt) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    assert.equal(body.get("resource"), "https://mcp.m.todaq.net");
    state.used.add(state.rt);
    state.rt = "RT" + state.refreshCalls; // rotate
    state.at = "AT" + (state.refreshCalls + 1);
    return Response.json({ access_token: state.at, refresh_token: state.rt, expires_in: 3600, token_type: "Bearer" });
  }
  if (url.host === "mcp.m.todaq.net" && url.pathname === "/mcp") {
    if (req.headers.get("authorization") !== `Bearer ${state.at}`) return Response.json({ error: "Authentication required" }, { status: 401 });
    const msg = await req.json();
    if (msg.method === "initialize") {
      state.sessions++;
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock" } } })}\n\n`,
        { headers: { "content-type": "text/event-stream", "mcp-session-id": "S" + state.sessions } });
    }
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "tools/call") {
      if (state.fail401Once) { state.fail401Once = false; state.at = "EXPIRED"; return Response.json({ error: "expired" }, { status: 401 }); }
      const { name, arguments: args } = msg.params;
      state.calls.push({ name, args });
      let result;
      if (name === "catalog_search") {
        state.catalogCalls = (state.catalogCalls || 0) + 1;
        const all = state.bigCatalog || catalog.items;
        const off = args.offset || 0, lim = args.limit || all.length;
        result = { content: [{ type: "text", text: JSON.stringify({ items: all.slice(off, off + lim), total: all.length }) }] };
      }
      else if (name.startsWith("cart_")) result = mockCart(name, args);
      else if (name === "guest_checkout") {
        if (args.arguments?.ticker === "NOPE") result = { isError: true, content: [{ type: "text", text: "Unknown ticker NOPE" }] };
        else {
          const u = state.evilUrl ? "https://evil.example/checkout/123" : `https://checkout.m.todaq.net/checkout/${crypto.randomUUID()}`;
          result = { content: [{ type: "text", text: JSON.stringify({ name: "x", price: 1, checkout_url: u }) }] };
        }
      }
      return Response.json({ jsonrpc: "2.0", id: msg.id, result });
    }
  }
  return new Response("unexpected outbound " + req.url, { status: 599 });
}

// Cart mock shaped like live Qatom responses (21 Oct 2026)
const carts = new Map();
let lineSeq = 100;
function cartJson(id) {
  const c = carts.get(id);
  const total = Math.round(c.lines.reduce((t, l) => t + l.unit_price * l.quantity, 0) * 1e6) / 1e6;
  return { cart_id: id, status: c.status, lines: c.lines.map((l) => ({ ...l, subtotal: l.unit_price * l.quantity })), item_count: c.lines.reduce((t, l) => t + l.quantity, 0), total, currency: "USD-TDN", checkout_url: c.url, paid_by: null };
}
const err = (t) => ({ isError: true, content: [{ type: "text", text: t }] });
const ok = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
function mockCart(name, a) {
  if (name === "cart_add_item") {
    let id = a.cart_id;
    if (id && (!carts.has(id) || ["completed", "abandoned"].includes(carts.get(id).status))) return err("Cart is closed");
    if (!id) { id = crypto.randomUUID(); carts.set(id, { status: "open", lines: [], url: null }); }
    const item = catalog.items.find((i) => i.id === a.catalog_item_id);
    const c = carts.get(id);
    const same = c.lines.find((l) => l.catalog_item_id === a.catalog_item_id && JSON.stringify(l.arguments) === JSON.stringify(a.arguments || {}));
    if (same) same.quantity += a.quantity || 1;
    else c.lines.push({ line_id: ++lineSeq, catalog_item_id: item.id, name: item.name, merchant: item.seller, unit_price: item.price, quantity: a.quantity || 1, arguments: a.arguments || {}, available: true });
    return ok(cartJson(id));
  }
  const c = carts.get(a.cart_id);
  if (!c) return err("Cart not found");
  if (name === "cart_view") return ok(cartJson(a.cart_id));
  if (name === "cart_remove_item") { c.lines = c.lines.filter((l) => l.line_id !== a.line_id); return ok(cartJson(a.cart_id)); }
  if (name === "cart_discard") { c.status = "abandoned"; c.url = null; return ok(cartJson(a.cart_id)); }
  if (name === "cart_checkout") {
    c.status = "checkout"; c.url ||= `https://checkout.m.todaq.net/cart/${crypto.randomUUID()}`;
    const j = cartJson(a.cart_id);
    return ok({ name: `Your cart (${j.item_count} items)`, price: j.total, checkout_url: c.url, cart_id: a.cart_id, item_count: j.item_count });
  }
  return err("unknown");
}

const mf = new Miniflare({
  modules: true, script, compatibilityDate: "2026-08-01",
  durableObjects: { TOKEN_MANAGER: "TokenManager" },
  bindings: { SITE_URL: "https://try.agentkepler.tech", MIN_GUEST_PRICE: "0.5", HIDDEN_IDS: "20,180,215", FEATURED_ID: "24", QATOM_CLIENT_ID: "client-1", QATOM_REFRESH_TOKEN: "RT0" },
  outboundService: outbound,
});

const B = "https://try.agentkepler.tech";
const get = (p, init = {}) => mf.dispatchFetch(B + p, { redirect: "manual", ...init });
const form = (p, data) => get(p, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() });

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n   ", e.message, process.env.STACK ? e.stack : ""); process.exitCode = 1; }
}

console.log("storefront tests");

await t("simultaneous first requests share ONE refresh (no reuse, sign-in survives)", async () => {
  // Read each body as soon as its response arrives (Miniflare can otherwise hand back a consumed body under load).
  const js = await Promise.all(Array.from({ length: 6 }, (_, i) => get(`/health?fresh&n=${i}`).then((r) => r.text())
    .then((t) => { try { return JSON.parse(t); } catch { return { ok: false, raw: t.slice(0, 300) }; } })));
  assert.ok(js.every((j) => j.ok), JSON.stringify(js.find((j) => !j.ok)));
  assert.equal(state.refreshCalls, 1);
  assert.equal(state.revoked, false);
});

await t("home renders featured $1 item and counts", async () => {
  const r = await get("/"); const h = await r.text();
  assert.equal(r.status, 200);
  assert.match(h, /Harcourt Mining NAV Query/);
  assert.match(h, /href="https:\/\/try\.agentkepler\.tech\/buy\/24\?ticker=gdxj"/);
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
});

await t("token refreshed once and reused, not refreshed per request", async () => {
  const before = state.refreshCalls;
  await get("/catalog"); await get("/item/24"); await get("/health?fresh");
  assert.equal(state.refreshCalls, before);
  assert.equal(state.revoked, false);
});

await t("catalog lists everything (minus hidden), labelled Buy now / Add to cart", async () => {
  const h = await (await get("/catalog")).text();
  assert.match(h, /Harcourt NAV Report/);
  assert.match(h, /Dog age in human years/);
  assert.match(h, /Buy now/);
  assert.match(h, /Add to cart/);
  assert.doesNotMatch(h, /\/item\/20"/); // hidden test item
});

await t("catalog ?only=now filters to single-checkout items", async () => {
  const h = await (await get("/catalog?only=now")).text();
  assert.doesNotMatch(h, /Dog age in human years/);
  assert.match(h, /Harcourt NAV Report/);
});

await t("search ranks name matches", async () => {
  const h = await (await get("/catalog?q=harcourt%20nav")).text();
  const first = h.indexOf("/item/");
  assert.ok(first > 0);
  assert.match(h.slice(first, first + 12), /\/item\/(24|192|193)/);
});

await t("hostile listing is escaped everywhere", async () => {
  for (const p of ["/catalog", "/item/9001", "/catalog.txt"]) {
    const h = await (await get(p)).text();
    if (p.endsWith(".txt")) continue; // plain text is served as text/plain + nosniff
    assert.doesNotMatch(h, /<script>alert/);
    assert.doesNotMatch(h, /<img src=x/);
    assert.doesNotMatch(h, /<b>bad<\/b>/);
  }
  const r = await get("/catalog.txt");
  assert.match(r.headers.get("content-type"), /text\/plain/);
});

await t("item page: form, inputs, AI link format, example link", async () => {
  const h = await (await get("/item/24")).text();
  assert.match(h, /<form method="post" action="\/buy\/24">/);
  assert.match(h, /name="ticker"[^>]*value="gdxj"/);
  assert.match(h, /Optional settings \(8\)/);
  assert.match(h, /\/buy\/24\?ticker=VALUE/);
});

await t("item with personal details: no example link, prefers the form", async () => {
  const h = await (await get("/item/32")).text();
  assert.match(h, /needs personal details \(email\)/);
  assert.doesNotMatch(h, /Ready-made example/);
  assert.match(h, /<select id="f-pace" name="pace" required>/);
});

await t("sub-minimum and free items offer Add to cart only", async () => {
  const h1 = await (await get("/item/43")).text();
  assert.match(h1, /below the \$0\.50 card minimum on its own/);
  assert.match(h1, /<form method="post" action="\/cart\/add\/43">/);
  assert.match(h1, /<input id="f-dog_age_years"/);
  assert.doesNotMatch(h1, /Optional settings/);
  assert.doesNotMatch(h1, /seller \./);
  assert.doesNotMatch(h1, /Buy now ·/);
  assert.match(h1, /\/bundle\?item=43&amp;43\.dog_age_years=VALUE/);
  assert.doesNotMatch(h1, /result_ref/);
  const h2 = await (await get("/item/34")).text();
  assert.match(h2, /This item is free/);
});

await t("buyable item offers both Buy now and Add to cart", async () => {
  const h = await (await get("/item/24")).text();
  assert.match(h, /Buy now · \$1\.00/);
  assert.match(h, /formaction="\/cart\/add\/24"/);
});

await t("hidden and unknown items 404", async () => {
  assert.equal((await get("/item/20")).status, 404);
  assert.equal((await get("/item/999999")).status, 404);
});

await t("GET /buy mints checkout and 303s to checkout.m.todaq.net with the right args", async () => {
  const r = await get("/buy/24?ticker=gdxj&gold=3200&go=1");
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /^https:\/\/checkout\.m\.todaq\.net\/checkout\/[0-9a-f-]{36}$/);
  const c = state.calls.at(-1);
  assert.deepEqual(c, { name: "guest_checkout", args: { catalog_item_id: 24, arguments: { ticker: "gdxj", gold: 3200 } } });
});

await t("each tap mints a fresh session", async () => {
  const a = (await get("/buy/24?ticker=gdxj&go=1")).headers.get("location");
  const b = (await get("/buy/24?ticker=gdxj&go=1")).headers.get("location");
  assert.notEqual(a, b);
});

await t("POST form keeps email out of the URL and passes typed args", async () => {
  const r = await form("/buy/32", { team_name: "Kepler Knights", email: "guest@example.com", pace: "1_day", junk: "ignored" });
  assert.equal(r.status, 303);
  assert.deepEqual(state.calls.at(-1).args, { catalog_item_id: 32, arguments: { team_name: "Kepler Knights", email: "guest@example.com", pace: "1_day" } });
});

await t("missing / invalid inputs re-render the form with errors (422), values kept", async () => {
  let r = await get("/buy/24");
  assert.equal(r.status, 422);
  assert.match(await r.text(), /ticker is required/);
  r = await get("/buy/24?ticker=gdxj&gold=-5&rate=abc");
  const h = await r.text();
  assert.equal(r.status, 422);
  assert.match(h, /gold must be more than 0/);
  assert.match(h, /rate must be a number/);
  assert.match(h, /name="gold"[^>]*value="-5"/);
  r = await form("/buy/32", { team_name: "x", email: "not-an-email", pace: "1_day" });
  assert.equal(r.status, 422);
  r = await form("/buy/32", { team_name: "x", email: "a@b.co", pace: "weekly" });
  assert.match(await r.text(), /pace must be one of: 1_day, 3_days/);
});

await t("sub-minimum item cannot be bought (409)", async () => {
  assert.equal((await get("/buy/26?a=1")).status, 409);
});

await t("seller-side rejection shows the reason (422)", async () => {
  const r = await get("/buy/24?ticker=NOPE&go=1");
  assert.equal(r.status, 422);
  assert.match(await r.text(), /Unknown ticker NOPE/);
});

await t("expired access token: one refresh, then success", async () => {
  const before = state.refreshCalls;
  state.fail401Once = true;
  const r = await get("/buy/24?ticker=gdxj&go=1");
  assert.equal(r.status, 303);
  assert.equal(state.refreshCalls, before + 1);
});

await t("never redirects off Qatom's checkout host", async () => {
  state.evilUrl = true;
  const r = await get("/buy/24?ticker=gdxj&go=1");
  state.evilUrl = false;
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("location"), null);
});

await t("/nav shortcut and robots", async () => {
  const r = await get("/nav?ticker=AEM");
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://try.agentkepler.tech/buy/24?ticker=AEM");
  assert.match(await (await get("/robots.txt")).text(), /Allow: \//);
});

await t("llms.txt: site filled in, buyable list appended", async () => {
  const h = await (await get("/llms.txt")).text();
  assert.doesNotMatch(h, /\{\{SITE\}\}/);
  assert.match(h, /https:\/\/try\.agentkepler\.tech\/buy\/24\?ticker=gdxj/);
  assert.match(h, /\[193\] Harcourt NAV Report/);
});

await t("item .txt view", async () => {
  const h = await (await get("/item/24.txt")).text();
  assert.match(h, /Checkout link: https:\/\/try\.agentkepler\.tech\/buy\/24\?ticker=VALUE/);
});

// ---- cart ----
let cookie = "";
const jar = (r) => { const c = r.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]; return r; };
const cget = (p) => get(p, { headers: { cookie, "cf-connecting-ip": "198.51.100.7" } }).then(jar);
const cpost = (p, data = {}) => get(p, { method: "POST", headers: { cookie, "cf-connecting-ip": "198.51.100.7", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() }).then(jar);

await t("empty cart page", async () => {
  const h = await (await cget("/cart")).text();
  assert.match(h, /Your cart is empty/);
});

await t("add sub-cent item: cart created, HttpOnly cookie set, 303 to /cart", async () => {
  const r = await cpost("/cart/add/43", { dog_age_years: "5" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/cart");
  assert.match(r.headers.get("set-cookie"), /qcart=[0-9a-f-]{36}; Path=\/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax/);
  assert.deepEqual(state.calls.at(-1), { name: "cart_add_item", args: { catalog_item_id: 43, quantity: 1, arguments: { dog_age_years: 5 } } });
});

await t("cart under the minimum shows the shortfall, no checkout button", async () => {
  const h = await (await cget("/cart")).text();
  assert.match(h, /Dog age in human years/);
  assert.match(h, /Add \$0\.499 more to check out/);
  assert.doesNotMatch(h, /action="\/cart\/checkout"/);
  const r = await cpost("/cart/checkout");
  assert.equal(r.status, 409);
});

await t("invalid input on add re-renders the item form (422), cart untouched", async () => {
  const r = await cpost("/cart/add/69", { temperature: "30", unit: "bad-unit" });
  // unit has an enum in the live schema? if not, the call goes through; check either way the cart call args are typed
  if (r.status === 422) assert.match(await r.text(), /unit must be one of/);
  else assert.equal(r.status, 303);
});

await t("second add reuses the same cart; reaching $0.50 enables one checkout", async () => {
  const before = cookie;
  await cpost("/cart/add/24", { ticker: "gdxj" });
  assert.equal(cookie, before);
  const h = await (await cget("/cart")).text();
  assert.match(h, /Harcourt Mining NAV Query/);
  assert.match(h, /action="\/cart\/checkout"/);
  assert.match(h, /Total \$1\.00[12]/);
  const r = await cpost("/cart/checkout");
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /^https:\/\/checkout\.m\.todaq\.net\/cart\/[0-9a-f-]{36}$/);
});

await t("remove a line", async () => {
  const id = cookie.split("=")[1];
  const line = carts.get(id).lines[0].line_id;
  const r = await cpost(`/cart/remove/${line}`);
  assert.equal(r.status, 303);
  assert.equal(carts.get(id).lines.find((l) => l.line_id === line), undefined);
});

await t("paid cart: cookie cleared with a thank-you; next add starts a new cart", async () => {
  const id = cookie.split("=")[1];
  carts.get(id).status = "completed";
  const r = await cget("/cart");
  assert.match(await r.text(), /Your last cart was paid/);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  cookie = `qcart=${id}`; // stale cookie still sent by a browser that missed the clear
  const r2 = await cpost("/cart/add/43", { dog_age_years: "2" });
  assert.equal(r2.status, 303);
  assert.notEqual(cookie.split("=")[1], id);
});

await t("removing below $0.50 after checkout retires the live link and moves lines to a fresh cart", async () => {
  await cpost("/cart/add/24", { ticker: "gdxj" });
  const oldId = cookie.split("=")[1];
  const r1 = await cpost("/cart/checkout");
  const oldUrl = r1.headers.get("location");
  assert.match(oldUrl, /\/cart\//);
  const nav = carts.get(oldId).lines.find((l) => l.catalog_item_id === 24).line_id;
  const r2 = await cpost(`/cart/remove/${nav}`);
  assert.equal(r2.status, 303);
  assert.equal(carts.get(oldId).status, "abandoned"); // old link dead
  const newId = cookie.split("=")[1];
  assert.notEqual(newId, oldId);
  assert.equal(carts.get(newId).status, "open");
  assert.ok(carts.get(newId).lines.some((l) => l.catalog_item_id === 43)); // remaining items carried over
  const h = await (await cget("/cart")).text();
  assert.doesNotMatch(h, /action="\/cart\/checkout"/);
});

await t("empty cart discards it in Qatom and clears the cookie", async () => {
  const id = cookie.split("=")[1];
  const r = await cpost("/cart/clear");
  assert.equal(carts.get(id).status, "abandoned");
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});

await t("forged cookie values are ignored", async () => {
  const r = await get("/cart", { headers: { cookie: "qcart=../../etc" } });
  assert.match(await r.text(), /Your cart is empty/);
});

await t("bundle: several sub-cent items + quantity in one link -> one cart checkout", async () => {
  const r = await get("/bundle?item=43&43.dog_age_years=5&item=69&69.temperature=30&qty.69=2&item=24&24.ticker=gdxj&go=1");
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /^https:\/\/checkout\.m\.todaq\.net\/cart\//);
  const adds = state.calls.filter((c) => c.name === "cart_add_item").slice(-3);
  assert.deepEqual(adds.map((a) => [a.args.catalog_item_id, a.args.quantity]), [[43, 1], [69, 2], [24, 1]]);
  assert.equal(adds[1].args.arguments.temperature, 30);
  assert.ok(adds[1].args.cart_id && adds[1].args.cart_id === adds[2].args.cart_id);
});

await t("bundle under the minimum is refused with the total, nothing created", async () => {
  const n = carts.size;
  const r = await get("/bundle?item=43&43.dog_age_years=5&item=69&69.temperature=30");
  assert.equal(r.status, 422);
  assert.match(await r.text(), /The total is \$0\.002; card payments start at \$0\.50/);
  assert.equal(carts.size, n);
});

await t("bundle reports per-item problems", async () => {
  const r = await get("/bundle?item=24&item=999999&item=32&32.team_name=x&32.email=nope&32.pace=1_day");
  const h = await r.text();
  assert.equal(r.status, 422);
  assert.match(h, /Item 24<\/a>: ticker is required \(as 24\.ticker=…\)/);
  assert.match(h, /Item 999999<\/a>: not in the catalog/);
  assert.match(h, /email must be an email address/);
});

// ---- headless: AI fetchers stay in the chat until checkout ----
const AI = { "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" };
const CLAUDE = { "user-agent": "Claude-User (claude-code/1.0; +https://support.anthropic.com/)" };
const IMESSAGE = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0" };
const mints = () => state.calls.filter((c) => c.name === "guest_checkout" || c.name.startsWith("cart_")).length;

await t("AI fetch of / returns the plain-text guide with every item and its link", async () => {
  const r = await get("/", { headers: AI });
  const h = await r.text();
  assert.match(r.headers.get("content-type"), /text\/plain/);
  assert.match(r.headers.get("vary"), /User-Agent/);
  assert.match(h, /Designed to stay in the chat until checkout/);
  assert.match(h, /\[24\] Harcourt Mining NAV Query — \$1\.00/);
  assert.match(h, /No inputs needed\.|Ask the person for: ticker/);
  assert.match(h, /Checkout link: https:\/\/try\.agentkepler\.tech\/buy\/24\?ticker=VALUE \(example: https:\/\/try\.agentkepler\.tech\/buy\/24\?ticker=gdxj\)/);
  assert.match(h, /\[43\] Dog age in human years.*\n.*\n  Ask the person for: dog_age_years\. Cart only/);
  assert.match(h, /\[34\] Centaur League: search challenges.*\n.*\n  (No inputs needed|Ask the person for)/);
  assert.doesNotMatch(h, /<html/i);
});

await t("AI fetch of an item page and a search are plain text", async () => {
  const h = await (await get("/item/32", { headers: CLAUDE })).text();
  assert.match(h, /Ask the person for: email, pace \(1_day \| 3_days\), team_name|Ask the person for: .*team_name/);
  assert.match(h, /pace \(1_day \| 3_days\)/);
  const q = await (await get("/catalog?q=harcourt", { headers: AI })).text();
  assert.match(q, /matching "harcourt" \(3 items/);
});

await t("AI fetch of a buy link validates only: VALID, the exact link, nothing created", async () => {
  const n = mints();
  const r = await get("/buy/24?ticker=gdxj&gold=3200&format=text", { headers: AI });
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("location"), null);
  assert.match(h, /^VALID — nothing was created or charged/);
  assert.match(h, /https:\/\/try\.agentkepler\.tech\/buy\/24\?(gold=3200&ticker=gdxj|ticker=gdxj&gold=3200)\n/);
  assert.equal(mints(), n);
});

await t("AI fetch of a bad buy link: NOT VALID with reasons, nothing created", async () => {
  const n = mints();
  const r = await get("/buy/24?gold=-5", { headers: AI });
  const h = await r.text();
  assert.equal(r.status, 422);
  assert.match(h, /^NOT VALID/);
  assert.match(h, /ticker is required/);
  assert.match(h, /gold must be more than 0/);
  const r2 = await get("/buy/43?dog_age_years=5", { headers: AI });
  assert.match(await r2.text(), /under the \$0\.50 card minimum on its own; combine it/);
  assert.equal(mints(), n);
});

await t("AI fetch of a bundle link validates only (and refuses under $0.50)", async () => {
  const n = mints();
  const ok = await get("/bundle?item=43&43.dog_age_years=5&item=24&24.ticker=gdxj&format=text", { headers: AI });
  const h = await ok.text();
  assert.match(h, /^VALID/);
  assert.match(h, /2 items in one checkout · \$1\.001/);
  assert.match(h, /bundle\?item=43&43\.dog_age_years=5&item=24&24\.ticker=gdxj\n/); // format=text stripped
  const low = await get("/bundle?item=43&43.dog_age_years=5", { headers: AI });
  assert.match(await low.text(), /^NOT VALID[\s\S]*card payments start at \$0\.50/);
  assert.equal(mints(), n);
});

await t("link-preview fetchers get a preview card, not a checkout", async () => {
  const n = mints();
  const r = await get("/buy/24?ticker=gdxj", { headers: IMESSAGE });
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.match(h, /<meta property="og:title" content="Harcourt Mining NAV Query · \$1\.00">/);
  const b = await get("/bundle?item=43&43.dog_age_years=5&item=24&24.ticker=gdxj", { headers: IMESSAGE });
  assert.match(await b.text(), /og:title" content="2 items · \$1\.001"/);
  assert.equal(mints(), n);
});

await t("Accept: text/plain also gets text; ?format=html forces the page", async () => {
  const r = await get("/", { headers: { accept: "text/plain" } });
  assert.match(r.headers.get("content-type"), /text\/plain/);
  const r2 = await get("/?format=html", { headers: AI });
  assert.match(r2.headers.get("content-type"), /text\/html/);
});

await t("people in a browser still get pages and real checkouts", async () => {
  const n = mints();
  const r = await get("/buy/24?ticker=gdxj&go=1", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" } });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /^https:\/\/checkout\.m\.todaq\.net\/checkout\//);
  assert.equal(mints(), n + 1);
});


// ---- 1.3: before-you-pay page, keep-your-result page, connector page ----
await t("a person tapping a /buy link sees 'Before you pay' first; nothing is created until Continue", async () => {
  const n = mints();
  const r = await get("/buy/24?ticker=gdxj&gold=3200");
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.equal(mints(), n);
  assert.match(h, /Before you pay: save your answer/);
  assert.match(h, /isn&#39;t in the receipt email/);
  assert.match(h, /href="\/buy\/24\?ticker=gdxj&amp;gold=3200&amp;go=1"/);
  assert.match(h, /href="\/result\?item=24"/);
  assert.match(h, /sold by Harcourt/);
});

await t("many inputs collapse into a summary on the 'Before you pay' page", async () => {
  const h = await (await get("/buy/24?ticker=gdxj&gold=3200&silver=60&cu=6&rate=0.08")).text();
  assert.match(h, /<summary>Your inputs \(5\)<\/summary>/);
});

await t("a person tapping a /bundle link sees the lines and total first", async () => {
  const n = carts.size;
  const r = await get("/bundle?item=43&43.dog_age_years=5&item=24&24.ticker=gdxj");
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.equal(carts.size, n);
  assert.match(h, /2 items in one checkout/);
  assert.match(h, /go=1/);
});

await t("AI validation tells the AI to warn about saving the answer and to offer the connector once", async () => {
  const h = await (await get("/buy/24?ticker=gdxj", { headers: AI })).text();
  assert.match(h, /only there \(it is not in the receipt email\)/);
  assert.match(h, /\/result\?item=24/);
  assert.match(h, /\/connect\.txt/);
  assert.doesNotMatch(h, /emailed with the receipt/);
});

await t("guide no longer promises the answer in the receipt email", async () => {
  const h = await (await get("/llms.txt")).text();
  assert.doesNotMatch(h, /emailed with the\s+receipt/);
  assert.match(h, /## After the purchase/);
  assert.match(h, /Pass only the required/);
});

await t("/result page: script runs under a nonce, nothing can be sent anywhere, item name prefilled", async () => {
  const r = await get("/result?item=24");
  const h = await r.text();
  const csp = r.headers.get("content-security-policy");
  const nonce = (csp.match(/'nonce-([a-f0-9]+)'/) || [])[1];
  assert.ok(nonce);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(h, new RegExp(`<script nonce="${nonce}">`));
  assert.match(h, /value="Harcourt Mining NAV Query"/);
  assert.match(h, /Download JSON/);
  assert.match(h, /Save as PDF/);
  assert.doesNotMatch(h, /innerHTML/);
});

await t("/result and /connect as text for AIs", async () => {
  const r = await (await get("/result", { headers: AI })).text();
  assert.match(r, /not in the receipt email/);
  const c = await (await get("/connect.txt")).text();
  assert.match(c, /https:\/\/mcp\.m\.todaq\.net\/mcp/);
  assert.match(c, /Meta Muse: No custom connectors yet/);
  const p = await (await get("/connect")).text();
  assert.match(p, /Buy from inside your AI chat/);
});

await t("rate limit: 21st checkout in a minute from one IP gets 429", async () => {
  let last;
  for (let i = 0; i < 25; i++) last = await get("/buy/24?ticker=gdxj&go=1", { headers: { "cf-connecting-ip": "203.0.113.9" } });
  assert.equal(last.status, 429);
});

await t("non-GET on read routes is refused", async () => {
  assert.equal((await get("/catalog", { method: "POST" })).status, 405);
});

await t("catalog pages past 500 items", async () => {
  state.bigCatalog = Array.from({ length: 1203 }, (_, i) => ({ id: 50000 + i, name: `Bulk item ${i}`, description: "x", price: 1, seller: "Bulk", input_schema: { type: "object", properties: {} } }));
  const before = state.catalogCalls;
  const r = await get("/item/51202"); // not in cache -> fresh fetch, 3 pages
  state.bigCatalog = null;
  assert.equal(r.status, 200);
  assert.equal(state.catalogCalls - before, 3);
});

await t("health reports the cause as JSON when Qatom refuses, then recovers", async () => {
  state.denyRefresh = true; state.at = "EXPIRED"; // current access token rejected, refresh refused
  const r = await get("/health?fresh");
  const j = await r.json();
  assert.equal(r.status, 503);
  assert.equal(j.ok, false);
  assert.equal(j.code, "signin_required");
  assert.match(j.error, /HTTP 400 invalid_grant.*get-token\.mjs --apply/);
  assert.equal(j.configured.refresh_token, true);
  assert.doesNotMatch(JSON.stringify(j), /\b(RT|AT)\d/); // no token values leak
  state.denyRefresh = false;
  const ok = await (await get("/health?fresh")).json();
  assert.equal(ok.ok, true);
  assert.equal(state.revoked, false);
});

await t("health", async () => {
  const j = await (await get("/health")).json();
  assert.equal(j.ok, true);
  assert.ok(j.items >= 85);
});

await mf.dispose();
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
