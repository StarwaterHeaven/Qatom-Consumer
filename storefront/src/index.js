// Qatom guest storefront — try.agentkepler.tech
// A read-only window onto the public Qatom catalog with one-time guest checkout links,
// so anyone's AI (Claude, ChatGPT, Grok, Muse…) can help them buy without an MCP connector.
//
//   GET  /                     home (featured $1 demo, how it works)
//   GET  /catalog[?q=&all=1]   browse/search; default shows items buyable here
//   GET  /item/:id             details, inputs form, AI-facing link format
//   GET  /buy/:id?field=…      validate inputs -> mint guest checkout -> 303 to checkout.m.todaq.net
//   POST /buy/:id              same, from the item form (keeps personal details out of URLs)
//   POST /cart/add/:id         add an item (with inputs) to the visitor's Qatom cart (cart id in a cookie)
//   GET  /cart                 cart lines, total, remove, checkout (one link pays for everything)
//   POST /cart/remove/:line, /cart/checkout, /cart/clear
//   GET  /bundle?item=ID&ID.input=v&item=ID2&qty.ID2=3   AI-buildable multi-item checkout -> 303
//   GET  /nav[?ticker=]        shortcut for the Harcourt NAV demo
//   GET  /llms.txt /catalog.txt /item/:id.txt   plain text for AI readers
//   GET  /robots.txt /health

import { getCatalog, mintCheckout, QatomError, cartAdd, cartView, cartRemove, cartDiscard, cartCheckout, validCartId } from "./qatom.js";
import { buildArgs } from "./validate.js";
import * as R from "./render.js";
import GUIDE from "./guide.txt";

const DEFAULTS = {
  site: "https://try.agentkepler.tech",
  minPrice: 0.5, // Stripe's card minimum in USD
  hidden: "20,180,215", // obvious test items
  featuredId: 24,
};

// Known-good example inputs, used for ready-made links and form prefill.
const EXAMPLES = {
  24: { ticker: "gdxj" },
  212: { wp_id: "DISTRICT", sponsor: "Qatom event guest" },
};

const FEATURED_BLURB =
  "Are junior gold miners trading above or below what their mines are worth? One live valuation of GDXJ (VanEck Junior Gold Miners ETF) from Harcourt Valuations, built from filed technical reports at today's metal prices. Informational only, not investment advice.";

function config(env) {
  return {
    site: (env.SITE_URL || DEFAULTS.site).replace(/\/+$/, ""),
    minPrice: Number(env.MIN_GUEST_PRICE ?? DEFAULTS.minPrice),
    hidden: new Set(String(env.HIDDEN_IDS ?? DEFAULTS.hidden).split(",").map((s) => Number(s.trim())).filter(Boolean)),
    featuredId: Number(env.FEATURED_ID || DEFAULTS.featuredId),
    featuredBlurb: FEATURED_BLURB,
    examples: EXAMPLES,
  };
}

const SECURITY = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self' https://checkout.m.todaq.net; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const html = (body, status = 200, cache = "public, max-age=60") =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache, ...SECURITY } });
const text = (body, status = 200, cache = "public, max-age=60") =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": cache, "x-content-type-options": "nosniff" } });

function log(event, data = {}) {
  console.log(JSON.stringify({ event, ...data, t: new Date().toISOString() }));
}

// ---------- rate limiting (buy only) ----------

const memHits = new Map();
async function allowed(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.BUY_LIMITER?.limit) {
    try { return (await env.BUY_LIMITER.limit({ key: ip })).success; } catch {}
  }
  const now = Date.now();
  const rec = memHits.get(ip) || { n: 0, reset: now + 60_000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 60_000; }
  rec.n++;
  memHits.set(ip, rec);
  if (memHits.size > 5000) memHits.clear();
  return rec.n <= 20;
}

// ---------- router ----------

export default {
  async fetch(request, env, ctx) {
    const cfg = config(env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method === "HEAD" ? "GET" : request.method;

    try {
      if (path === "/robots.txt") return text("User-agent: *\nAllow: /\n", 200, "public, max-age=3600");
      if (path === "/favicon.ico") return new Response(null, { status: 204 });

      if (path === "/health") {
        const json = (o, st) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        try {
          const c = await getCatalog(env, ctx, { fresh: url.searchParams.has("fresh") });
          return json({ ok: true, items: c.items.length, fetched_at: c.fetched_at }, 200);
        } catch (e) {
          // Never includes tokens: messages carry status codes and the server's error text only.
          return json({
            ok: false, code: e.code || "error", error: String(e.message || e).slice(0, 400),
            configured: { client_id: !!env.QATOM_CLIENT_ID, refresh_token: !!env.QATOM_REFRESH_TOKEN, static_token: !!env.QATOM_MCP_TOKEN, kv: !!env.TOKENS },
          }, 503);
        }
      }

      if (path === "/llms.txt") {
        const c = await getCatalog(env, ctx).catch(() => null);
        return text(GUIDE.replaceAll("{{SITE}}", cfg.site) + (c ? "\n" + R.catalogText({ catalog: c, cfg, all: true }) : ""));
      }

      if (method !== "GET" && !(method === "POST" && (path.startsWith("/buy/") || path.startsWith("/cart/")))) {
        return text("Method not allowed", 405);
      }

      if (path === "/") return html(R.home({ catalog: await getCatalog(env, ctx), cfg }));

      if (path === "/catalog") {
        const q = (url.searchParams.get("q") || "").slice(0, 100);
        const all = url.searchParams.get("only") === "now" ? "now" : "";
        return html(R.catalogPage({ catalog: await getCatalog(env, ctx), cfg, q, all }));
      }
      if (path === "/catalog.txt") return text(R.catalogText({ catalog: await getCatalog(env, ctx), cfg }));

      if (path === "/nav") {
        const t = url.searchParams.get("ticker") || "gdxj";
        return Response.redirect(`${cfg.site}/buy/24?ticker=${encodeURIComponent(t)}`, 302);
      }

      let m = path.match(/^\/item\/(\d{1,9})(\.txt)?$/);
      if (m) {
        const item = await findItem(env, ctx, Number(m[1]), cfg);
        if (!item) return notFound(cfg);
        return m[2] ? text(R.itemText({ item, cfg })) : html(R.itemPage({ item, cfg }));
      }

      m = path.match(/^\/buy\/(\d{1,9})$/);
      if (m) return buy(request, env, ctx, cfg, Number(m[1]), url);

      if (path === "/cart" && method === "GET") return showCart(request, env, cfg);
      m = path.match(/^\/cart\/add\/(\d{1,9})$/);
      if (m && method === "POST") return addToCart(request, env, ctx, cfg, Number(m[1]));
      m = path.match(/^\/cart\/remove\/(\d{1,9})$/);
      if (m && method === "POST") return removeLine(request, env, cfg, Number(m[1]));
      if (path === "/cart/checkout" && method === "POST") return checkoutCart(request, env, cfg);
      if (path === "/cart/clear" && method === "POST") return clearCart(request, env, cfg);
      if (path === "/bundle" && method === "GET") return bundle(request, env, ctx, cfg, url);

      return notFound(cfg);
    } catch (e) {
      log("error", { path, message: String(e.message || e), code: e.code });
      const msg = e instanceof QatomError && e.code === "not_configured"
        ? "The storefront isn't connected to Qatom yet."
        : "The Qatom catalog is briefly unavailable. Please try again in a moment.";
      return html(R.errorPage({ heading: "Something went wrong", message: msg, retry: url.pathname + url.search, cfg }), 503, "no-store");
    }
  },
};

function notFound(cfg) {
  return html(R.errorPage({ heading: "Not found", message: "That page or item isn't in the Qatom catalog. It may have been removed or made private by its seller.", cfg }), 404);
}

async function findItem(env, ctx, id, cfg) {
  if (cfg.hidden.has(id)) return null;
  let c = await getCatalog(env, ctx);
  let item = c.items.find((i) => Number(i.id) === id);
  if (!item) {
    // New items appear before the cache expires: look once more, fresh.
    c = await getCatalog(env, ctx, { fresh: true });
    item = c.items.find((i) => Number(i.id) === id);
  }
  return item || null;
}

async function buy(request, env, ctx, cfg, id, url) {
  const item = await findItem(env, ctx, id, cfg);
  if (!item) return notFound(cfg);

  if (!R.buyability(item, cfg).ok) {
    return html(R.itemPage({ item, cfg, status: `This item is below the ${R.price(cfg.minPrice)} card minimum on its own. Add it to your cart with other items instead.` }), 409, "no-store");
  }

  const params = await readParams(request, url);

  const { args, errors, missing } = buildArgs(item.input_schema, params);
  if (missing.length || errors.length) {
    const all = [...missing.map((n) => `${n} is required`), ...errors];
    log("buy_invalid", { id, missing, n_errors: errors.length });
    return html(R.itemPage({ item, cfg, values: params, errors: all }), 422, "no-store");
  }

  if (!(await allowed(env, request))) {
    log("rate_limited", { id });
    return html(R.errorPage({ heading: "One moment", message: "Too many checkout links from this connection just now. Please wait a minute and try again.", retry: `/item/${id}`, cfg }), 429, "no-store");
  }

  try {
    const checkout = await mintCheckout(env, id, args);
    log("checkout_minted", { id, price: item.price });
    return new Response(null, { status: 303, headers: { location: checkout, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (e) {
    log("checkout_failed", { id, message: String(e.message || e), code: e.code });
    if (e.code === "tool_rejected") {
      return html(R.itemPage({ item, cfg, values: params, errors: [`Qatom couldn't start this checkout: ${String(e.message).slice(0, 300)}`] }), 422, "no-store");
    }
    return html(R.errorPage({ heading: "Checkout is briefly unavailable", message: "We couldn't open a checkout just now. Nothing was charged. Please try again in a moment.", retry: `/item/${id}`, cfg }), 503, "no-store");
  }
}

// ---------- shared helpers ----------

async function readParams(request, url) {
  if (request.method !== "POST") return url.searchParams;
  const params = new URLSearchParams();
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const [k, v] of form) if (typeof v === "string") params.set(k, v.slice(0, 2000));
  }
  return params;
}

// ---------- cart (visitor's Qatom cart; only its id lives in an HttpOnly cookie) ----------

const COOKIE = "qcart";

function cartIdFrom(request) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(/(?:^|;\s*)qcart=([0-9a-fA-F-]{36})/);
  return m && validCartId(m[1]) ? m[1] : null;
}
const setCookie = (id) => `${COOKIE}=${id}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function redirect(location, cookie) {
  const h = { location, "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (cookie) h["set-cookie"] = cookie;
  return new Response(null, { status: 303, headers: h });
}

function withCookie(res, cookie) {
  if (cookie) res.headers.append("set-cookie", cookie);
  return res;
}

const CLOSED = new Set(["completed", "abandoned", "finished", "cancelled", "canceled"]);

async function showCart(request, env, cfg, { notice = "", errors = [], status = 200 } = {}) {
  const id = cartIdFrom(request);
  if (!id) return html(R.cartPage({ cart: null, cfg, notice, errors }), status, "no-store");
  let cart;
  try { cart = await cartView(env, id); }
  catch (e) {
    if (e.code === "tool_rejected") return withCookie(html(R.cartPage({ cart: null, cfg, notice: notice || "Your previous cart has expired." }), status, "no-store"), clearCookie());
    throw e;
  }
  if (CLOSED.has(String(cart.status))) {
    const msg = cart.status === "completed" ? "Your last cart was paid. Thank you! Your receipt has been emailed." : "Your previous cart was closed.";
    return withCookie(html(R.cartPage({ cart: null, cfg, notice: notice || msg }), status, "no-store"), clearCookie());
  }
  return html(R.cartPage({ cart, cfg, notice, errors }), status, "no-store");
}

async function addToCart(request, env, ctx, cfg, id) {
  const item = await findItem(env, ctx, id, cfg);
  if (!item) return notFound(cfg);
  const params = await readParams(request, new URL(request.url));
  const { args, errors, missing } = buildArgs(item.input_schema, params);
  if (missing.length || errors.length) {
    return html(R.itemPage({ item, cfg, values: params, errors: [...missing.map((n) => `${n} is required`), ...errors] }), 422, "no-store");
  }
  if (!(await allowed(env, request))) return tooMany(cfg, `/item/${id}`);
  const qty = Math.min(20, Math.max(1, parseInt(params.get("quantity") || "1", 10) || 1));

  let current = cartIdFrom(request);
  let cart;
  try {
    cart = await cartAdd(env, current, id, args, qty);
  } catch (e) {
    // The old cart may be paid, paying, or gone: start a new one.
    if (current && e.code === "tool_rejected") { current = null; cart = await cartAdd(env, null, id, args, qty); }
    else if (e.code === "tool_rejected") {
      return html(R.itemPage({ item, cfg, values: params, errors: [`Qatom couldn't add this: ${String(e.message).slice(0, 300)}`] }), 422, "no-store");
    } else throw e;
  }
  if (!validCartId(cart.cart_id)) throw new QatomError("cart id missing");
  log("cart_add", { id, qty });
  return redirect("/cart", setCookie(cart.cart_id));
}

async function removeLine(request, env, cfg, lineId) {
  const id = cartIdFrom(request);
  if (!id) return redirect("/cart");
  let after;
  try { after = await cartRemove(env, id, lineId); }
  catch (e) {
    if (e.code === "tool_rejected") return showCart(request, env, cfg, { errors: [String(e.message).slice(0, 300)], status: 409 });
    throw e;
  }
  // Minimum guard: a checked-out cart keeps its live link after a removal. If the
  // total has dropped below the card minimum, retire that cart (its link stops working)
  // and move the remaining lines into a fresh, not-yet-checked-out cart.
  if (after && after.status === "checkout" && Number(after.total || 0) < cfg.minPrice) {
    let fresh = null;
    for (const l of after.lines || []) {
      const c = await cartAdd(env, fresh, Number(l.catalog_item_id), l.arguments || {}, Number(l.quantity) || 1);
      fresh = c.cart_id;
    }
    try { await cartDiscard(env, id); } catch (e) { if (e.code !== "tool_rejected") throw e; }
    log("cart_relinked_below_min", { lines: (after.lines || []).length });
    return redirect("/cart", fresh ? setCookie(fresh) : clearCookie());
  }
  return redirect("/cart");
}

async function clearCart(request, env, cfg) {
  const id = cartIdFrom(request);
  if (id) { try { await cartDiscard(env, id); } catch (e) { if (e.code !== "tool_rejected") throw e; } }
  return redirect("/cart", clearCookie());
}

async function checkoutCart(request, env, cfg) {
  const id = cartIdFrom(request);
  if (!id) return redirect("/cart");
  if (!(await allowed(env, request))) return tooMany(cfg, "/cart");
  const cart = await cartView(env, id).catch((e) => { if (e.code === "tool_rejected") return null; throw e; });
  if (!cart || CLOSED.has(String(cart.status))) return redirect("/cart");
  if (Number(cart.total || 0) < cfg.minPrice) {
    return showCart(request, env, cfg, { errors: [`Card payments start at ${R.price(cfg.minPrice)}. Add a little more to your cart.`], status: 409 });
  }
  if ((cart.lines || []).some((l) => l.available === false)) {
    return showCart(request, env, cfg, { errors: ["Something in your cart is no longer available. Please remove it first."], status: 409 });
  }
  const { url } = await cartCheckout(env, id);
  log("cart_checkout", { lines: (cart.lines || []).length, total: cart.total });
  return redirect(url);
}

// /bundle?item=43&43.dog_age_years=5&item=69&69.temperature=30&qty.69=2
// Builds a fresh cart each time (independent of the visitor's cookie cart) and 303s to its checkout.
async function bundle(request, env, ctx, cfg, url) {
  const ids = [...new Set(url.searchParams.getAll("item").map((x) => parseInt(x, 10)).filter((n) => n > 0))].slice(0, 20);
  if (!ids.length) return html(R.bundleErrorPage({ problems: [{ message: "No items given. Use ?item=ID&item=ID2…" }], cfg }), 400, "no-store");

  const lines = [];
  const problems = [];
  for (const id of ids) {
    const item = await findItem(env, ctx, id, cfg);
    if (!item) { problems.push({ id, message: "not in the catalog" }); continue; }
    const sub = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (k.startsWith(`${id}.`)) sub.set(k.slice(String(id).length + 1), v);
    const { args, errors, missing } = buildArgs(item.input_schema, sub);
    for (const n of missing) problems.push({ id, message: `${n} is required (as ${id}.${n}=…)` });
    for (const e of errors) problems.push({ id, message: e });
    const qty = Math.min(20, Math.max(1, parseInt(url.searchParams.get(`qty.${id}`) || "1", 10) || 1));
    lines.push({ id, args, qty, price: Number(item.price) || 0 });
  }
  const total = lines.reduce((t, l) => t + l.price * l.qty, 0);
  if (!problems.length && total < cfg.minPrice) {
    problems.push({ message: `The total is ${R.price(total)}; card payments start at ${R.price(cfg.minPrice)}. Add more items or a higher quantity.` });
  }
  if (problems.length) {
    log("bundle_invalid", { n: problems.length });
    return html(R.bundleErrorPage({ problems, cfg }), 422, "no-store");
  }
  if (!(await allowed(env, request))) return tooMany(cfg, "/catalog");

  let cartId = null;
  try {
    for (const l of lines) {
      const c = await cartAdd(env, cartId, l.id, l.args, l.qty);
      cartId = c.cart_id;
    }
    const { url: checkout } = await cartCheckout(env, cartId);
    log("bundle_checkout", { lines: lines.length, total });
    return redirect(checkout);
  } catch (e) {
    if (cartId) ctx?.waitUntil?.(cartDiscard(env, cartId).catch(() => {}));
    if (e.code === "tool_rejected") return html(R.bundleErrorPage({ problems: [{ message: `Qatom couldn't build this checkout: ${String(e.message).slice(0, 300)}` }], cfg }), 422, "no-store");
    throw e;
  }
}

function tooMany(cfg, retry) {
  log("rate_limited", {});
  return html(R.errorPage({ heading: "One moment", message: "Too many checkouts from this connection just now. Please wait a minute and try again.", retry, cfg }), 429, "no-store");
}
