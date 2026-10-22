// HTML and plain-text rendering. Every value from the catalog is untrusted: escape it.
import { fields, sensitive } from "./validate.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Escape, then turn bare https URLs into links.
function linkify(s) {
  return esc(s).replace(/https:\/\/[^\s<>"']+[^\s<>"'.,;:)]/g, (u) => `<a href="${u}" rel="nofollow noopener">${u}</a>`);
}

export function price(p) {
  const n = Number(p);
  if (!n) return "Free";
  // exact: $1.00, $0.10, $1.002, $0.001 (never round a sub-cent amount away)
  const six = n.toFixed(6).replace(/0+$/, "");
  const [, dec = ""] = six.split(".");
  return "$" + (dec.length <= 2 ? n.toFixed(2) : six);
}

export function summary(desc, max = 180) {
  const d = String(desc || "").replace(/\s+/g, " ").trim();
  const first = d.match(/^.*?[.!?](\s|$)/);
  const s = first && first[0].length >= 40 ? first[0].trim() : d;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const CSS = `
:root{--ink:#0d1f1e;--muted:#4a5c5a;--line:#d7e2e0;--mist:#f2f7f6;--teal:#0f4c4a;--verd:#2f8f83;--bg:#fff;--card:#fff;--warn:#8a4b00;--warnbg:#fff6e5}
@media (prefers-color-scheme:dark){:root{--ink:#e8f1f0;--muted:#a9bcba;--line:#2a3b3a;--mist:#132221;--teal:#0b3735;--verd:#5cc0b2;--bg:#0b1615;--card:#0f1d1c;--warn:#ffcf8a;--warnbg:#2b2110}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--verd)}main{max-width:760px;margin:0 auto;padding:0 16px 48px}
.hero{background:var(--teal);color:#fff;padding:28px 16px 30px}.hero .in{max-width:760px;margin:0 auto}
.hero a{color:#bfe9e2}.eyebrow{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--verd)}
.hero .eyebrow{color:#9fdcd2}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:600;line-height:1.2}
h1{font-size:30px;margin:10px 0 8px}h2{font-size:22px;margin:32px 0 10px}p{margin:8px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0}
.card h3{margin:0 0 4px;font-size:17px}.card h3 a{color:var(--ink);text-decoration:none}
.meta{color:var(--muted);font-size:14px}.price{font-weight:700}
.badge{display:inline-block;font:600 11px/1 ui-monospace,Menlo,monospace;padding:5px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted);vertical-align:middle;margin-left:6px}
.badge.go{border-color:var(--verd);color:var(--verd)}
.btn{display:inline-block;background:var(--verd);color:#fff;border:0;border-radius:12px;padding:13px 18px;font-family:inherit;font-weight:600;font-size:16px;line-height:1.2;text-decoration:none;cursor:pointer;width:100%;text-align:center;margin-top:8px}
.btn.alt{background:transparent;color:var(--verd);border:1px solid var(--verd)}
form label{display:block;font-weight:600;margin:14px 0 4px}form .hint{font-weight:400;color:var(--muted);font-size:14px;display:block}
input,select{width:100%;font-family:inherit;font-size:16px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
details{margin-top:12px}summary{cursor:pointer;color:var(--verd)}
.search{display:flex;gap:8px;margin:14px 0}.search input{flex:1}.search .btn{width:auto;margin:0}
.note{background:var(--mist);border-radius:12px;padding:12px 14px;font-size:15px}
.err{background:var(--warnbg);color:var(--warn);border-radius:12px;padding:12px 14px}
.desc{white-space:pre-wrap;overflow-wrap:anywhere}code{font:14px ui-monospace,Menlo,monospace;overflow-wrap:anywhere;background:var(--mist);padding:1px 4px;border-radius:5px}
ol{padding-left:20px}footer{border-top:1px solid var(--line);margin-top:40px;padding-top:16px;color:var(--muted);font-size:14px}
`;

export function page({ title, eyebrow = "Qatom · Try it", heading, intro = "", body, cfg }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Buy from the Qatom catalog with any AI assistant, no setup: browse items and pay with a one-time checkout link.">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Guide for AI assistants">
<style>${CSS}</style></head><body>
<header class="hero"><div class="in"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(heading)}</h1>${intro ? `<p>${intro}</p>` : ""}</div></header>
<main>${body}
<footer><p>Qatom is run by TODAQ Micro, doing business as Qatom (Delaware corporation, team in Toronto). <a href="https://qatom.ai">qatom.ai</a> · <a href="https://todaq.net">todaq.net</a> · questions and refunds: <a href="mailto:support@todaq.net">support@todaq.net</a></p>
<p><a href="/">Home</a> · <a href="/catalog">Catalog</a> · <a href="/llms.txt">Guide for AI assistants</a> · <a href="https://github.com/StarwaterHeaven/Qatom-Consumer">Source code</a></p></footer>
</main></body></html>`;
}

function badge(item, cfg) {
  const b = buyability(item, cfg);
  if (b.ok) return `<span class="badge go">Buy now</span>`;
  if (b.reason === "free") return `<span class="badge">Free · add to cart</span>`;
  return `<span class="badge">Add to cart</span>`;
}

export function buyability(item, cfg) {
  const p = Number(item.price);
  if (!p) return { ok: false, reason: "free" };
  if (p < cfg.minPrice) return { ok: false, reason: "below_min" };
  return { ok: true };
}

function itemCard(item, cfg) {
  return `<div class="card"><h3><a href="/item/${item.id}">${esc(item.name)}</a>${badge(item, cfg)}</h3>
<div class="meta"><span class="price">${price(item.price)}</span>${item.seller ? ` · ${esc(item.seller)}` : ""}</div>
<p>${esc(summary(item.description))}</p></div>`;
}

// ---------- pages ----------

export function home({ catalog, cfg }) {
  const items = visible(catalog.items, cfg);
  const featured = items.find((i) => i.id === cfg.featuredId);
  const buyable = items.filter((i) => buyability(i, cfg).ok);
  const fx = featured ? exampleLink(featured, cfg) : null;
  const body = `
${featured ? `<h2>Try it for ${price(featured.price)}</h2>
<div class="card"><h3><a href="/item/${featured.id}">${esc(featured.name)}</a></h3>
<div class="meta"><span class="price">${price(featured.price)}</span> · ${esc(featured.seller)}</div>
<p>${esc(cfg.featuredBlurb || summary(featured.description, 260))}</p>
${fx ? `<a class="btn" href="${esc(fx)}">Buy for ${price(featured.price)}</a>` : ""}
<a class="btn alt" href="/item/${featured.id}">Details and other options</a></div>` : ""}
<h2>Browse the catalog</h2>
<p>${items.length} items from Qatom sellers. ${buyable.length} can be bought on their own; the rest cost less than a cent per call (or nothing), so you add them to a cart and pay for everything at once once it reaches ${price(cfg.minPrice)}.</p>
<a class="btn" href="/catalog">See what's for sale</a>
<h2>How it works</h2>
<ol><li>Pick an item here, or ask your AI to find one for you on this site.</li>
<li>Tap Buy now, or add several items to your cart. A checkout page opens on checkout.m.todaq.net, Qatom's hosted checkout. Pay with Apple Pay, Google Pay or card (processed by Stripe).</li>
<li>Enter and verify your email to receive a secure receipt with proof of purchase. Nothing is charged unless you complete the checkout.</li>
<li>Your answer appears on the checkout page once you've paid, and only there (it isn't in the receipt email). Copy it or take a screenshot before closing the page, then paste it back to your AI, or into <a href="/result">Keep your result</a> to save it as a file.</li></ol>
<p class="meta">Buying often? <a href="/connect">Connect your AI to Qatom</a> and answers come straight back into your chat.</p>
<h2>For AI assistants</h2>
<div class="note"><p>This site is a read-only window onto the public Qatom catalog with one-time checkout links. Nothing here needs a connector, an account, or an AI that spends money; the person pays on the checkout page themselves.</p>
<p>Full catalog: <a href="/catalog">/catalog</a> · plain text: <a href="/llms.txt">/llms.txt</a> and <a href="/catalog.txt">/catalog.txt</a>. Each item page shows its inputs, its buy link format, and how to combine several items into one checkout link.</p></div>`;
  return page({
    title: "Try Qatom — buy with any AI",
    heading: "Buy from AI sellers with any AI. No setup.",
    intro: "Qatom is a marketplace where sellers publish data, tools and digital goods that AI agents can find and pay for per use. Try a purchase from your phone in about a minute.",
    body, cfg,
  });
}

export function catalogPage({ catalog, cfg, q, all }) {
  let items = visible(catalog.items, cfg);
  if (all === "now") items = items.filter((i) => buyability(i, cfg).ok);
  if (q) items = search(items, q);
  const body = `
<form class="search" method="get" action="/catalog"><input name="q" value="${esc(q)}" placeholder="Search, e.g. gold, chess, weather" aria-label="Search the catalog"><button class="btn">Search</button></form>
<p class="meta">${items.length} ${items.length === 1 ? "item" : "items"}${q ? ` matching “${esc(q)}”` : ""} · <a href="/cart">Your cart</a> · “Add to cart” items are combined and paid together once the cart reaches ${price(cfg.minPrice)}.</p>
${items.map((i) => itemCard(i, cfg)).join("") || `<p>Nothing matches yet. <a href="/catalog">See the whole catalog</a>.</p>`}`;
  return page({ title: "Qatom catalog", heading: q ? `Catalog: “${q}”` : "The Qatom catalog", intro: "Live items from every Qatom seller. Prices are set by each seller.", body, cfg });
}

export function itemPage({ item, cfg, values = null, errors = [], status = "" }) {
  const b = buyability(item, cfg);
  const fs = fields(item.input_schema);
  const anyReq = fs.some((f) => f.required);
  const req = anyReq ? fs.filter((f) => f.required) : fs; // nothing marked required: show every input up front
  const opt = anyReq ? fs.filter((f) => !f.required) : [];
  const ex = exampleLink(item, cfg);
  const errBlock = errors.length ? `<div class="err" role="alert"><strong>Please check:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "";

  const fieldsHtml = `${req.map((f) => input(f, values, cfg, item.id)).join("")}
${opt.length ? `<details${values && opt.some((f) => values.get(f.name)) ? " open" : ""}><summary>Optional settings (${opt.length})</summary>${opt.map((f) => input(f, values, cfg, item.id)).join("")}</details>` : ""}`;
  const buy = b.ok
    ? `<h2>Buy for ${price(item.price)}</h2>${errBlock}
<form method="post" action="/buy/${item.id}">${fieldsHtml}
<button class="btn" type="submit">Buy now · ${price(item.price)}</button>
<button class="btn alt" type="submit" formaction="/cart/add/${item.id}">Add to cart</button>
<p class="meta">Buy now opens Qatom's hosted checkout for this item. Nothing is charged until you complete it.</p>
<div class="note"><p>${esc(SAVE_NOTE)} <a href="/result?item=${item.id}">Keep your result</a> turns it into a file.</p></div></form>`
    : `<h2>Add to cart · ${price(item.price)}</h2>${errBlock}
<form method="post" action="/cart/add/${item.id}">${fieldsHtml}
<button class="btn" type="submit">Add to cart</button>
<p class="meta">${b.reason === "free" ? "This item is free." : `At ${price(item.price)} per call this is below the ${price(cfg.minPrice)} card minimum on its own.`} Add it to your cart with other items and pay for everything in one checkout once the cart reaches ${price(cfg.minPrice)}.</p></form>`;

  const ai = `<h2>For AI assistants</h2><div class="note">
<p>Catalog item ${item.id} · ${esc(item.name)} · ${price(item.price)}${item.seller ? ` · seller ${esc(item.seller)}` : ""}.</p>
${b.ok ? `<p>Single-item checkout link (the person opens it and pays themselves): <code>${esc(cfg.site)}/buy/${item.id}${req.length ? "?" + req.map((f) => `${esc(f.name)}=VALUE`).join("&amp;") : ""}</code>${opt.length ? `. Optional: ${opt.map((f) => `<code>${esc(f.name)}</code>`).join(", ")}` : ""}. Values must be URL-encoded.</p>
${ex ? `<p>Ready-made example: <a href="${esc(ex)}">${esc(ex)}</a></p>` : ""}` : `<p>Too small to check out on its own (minimum ${price(cfg.minPrice)} per checkout); combine it with other items.</p>`}
<p>Several items in one checkout: <code>${esc(cfg.site)}/bundle?item=${item.id}${fs.length ? `&amp;${item.id}.${esc((req[0] || fs[0]).name)}=VALUE` : ""}&amp;item=OTHER_ID…</code> — repeat <code>item=ID</code> per item, prefix each input with its item ID, add <code>qty.ID=N</code> for quantities. The combined total must reach ${price(cfg.minPrice)}.</p>
${req.some(sensitive) ? `<p>This item needs personal details (${req.filter(sensitive).map((f) => esc(f.name)).join(", ")}). Ask the person in the chat and put them in the link; the link is meant only for that person.</p>` : ""}
</div>`;

  const body = `${status ? `<div class="err" role="alert">${esc(status)}</div>` : ""}
<div class="card"><div class="meta"><span class="price">${price(item.price)}</span>${item.seller ? ` · ${esc(item.seller)}` : ""}${badge(item, cfg)}</div>
<p class="desc">${linkify(item.description)}</p></div>
${buy}
${ai}`;
  return page({ title: `${item.name} — Qatom`, eyebrow: `Qatom catalog · item ${item.id}`, heading: item.name, body, cfg });
}

export function errorPage({ heading, message, retry, cfg, status }) {
  return page({
    title: heading,
    heading,
    body: `<div class="err" role="alert"><p>${esc(message)}</p></div>${retry ? `<a class="btn" href="${esc(retry)}">Try again</a>` : ""}<a class="btn alt" href="/catalog">Back to the catalog</a>`,
    cfg,
  });
}

function input(f, values, cfg, id) {
  const v = values ? values.get(f.name) ?? "" : (cfg.examples[id]?.[f.name] ?? f.default ?? "");
  const t = Array.isArray(f.type) ? f.type.find((x) => x !== "null") : f.type;
  const hint = f.description ? `<span class="hint">${esc(f.description)}</span>` : "";
  const label = `<label for="f-${esc(f.name)}">${esc(prettyName(f.name))}${f.required ? "" : " (optional)"}${hint}</label>`;
  const req = f.required ? " required" : "";
  if (f.enum) {
    return `${label}<select id="f-${esc(f.name)}" name="${esc(f.name)}"${req}>${f.required ? "" : `<option value="">(default)</option>`}${f.enum.map((o) => `<option${String(o) === String(v) ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  }
  if (t === "boolean") {
    return `${label}<select id="f-${esc(f.name)}" name="${esc(f.name)}"${req}><option value="">(default)</option><option value="true"${String(v) === "true" ? " selected" : ""}>Yes</option><option value="false"${String(v) === "false" ? " selected" : ""}>No</option></select>`;
  }
  let type = "text", extra = "";
  if (t === "number" || t === "integer") { type = "number"; extra = ` step="${t === "integer" ? 1 : "any"}" inputmode="decimal"`; }
  else if (f.format === "email" || /email/i.test(f.name)) { type = "email"; extra = ` autocomplete="email"`; }
  else if (f.format === "date") type = "date";
  if (f.maxLength) extra += ` maxlength="${Number(f.maxLength)}"`;
  return `${label}<input id="f-${esc(f.name)}" name="${esc(f.name)}" type="${type}" value="${esc(v)}"${extra}${req}>`;
}

function prettyName(n) {
  const s = n.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cartPage({ cart, cfg, notice = "", errors = [] }) {
  const lines = (cart && cart.lines) || [];
  const total = Number(cart?.total || 0);
  const short = Math.max(0, cfg.minPrice - total);
  const errBlock = errors.length ? `<div class="err" role="alert"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "";
  const body = `${notice ? `<div class="note" role="status">${esc(notice)}</div>` : ""}${errBlock}
${lines.length ? lines.map((l) => `<div class="card"><h3><a href="/item/${Number(l.catalog_item_id)}">${esc(l.name)}</a>${l.available === false ? `<span class="badge">unavailable</span>` : ""}</h3>
<div class="meta"><span class="price">${price(l.subtotal)}</span>${l.quantity > 1 ? ` · ${Number(l.quantity)} × ${price(l.unit_price)}` : ""}${l.merchant ? ` · ${esc(l.merchant)}` : ""}</div>
${l.arguments && Object.keys(l.arguments).length ? `<p class="meta">${Object.entries(l.arguments).map(([k, v]) => `${esc(k)}: ${esc(typeof v === "object" ? JSON.stringify(v) : v)}`).join(" · ")}</p>` : ""}
<form method="post" action="/cart/remove/${Number(l.line_id)}"><button class="btn alt" type="submit">Remove</button></form></div>`).join("")
  : `<p>Your cart is empty.</p>`}
${lines.length ? `<div class="card"><div class="meta">${Number(cart.item_count || lines.length)} item${(cart.item_count || lines.length) === 1 ? "" : "s"}</div><h3>Total ${price(total) === "Free" ? "$0.00" : price(total)}</h3>
${short > 0 ? `<p>Add ${price(short)} more to check out: card payments start at ${price(cfg.minPrice)}.</p><a class="btn" href="/catalog">Keep shopping</a>`
  : `<form method="post" action="/cart/checkout"><button class="btn" type="submit">Check out · ${price(total)}</button></form><p class="meta">One checkout page for everything in your cart. Each item is delivered to its seller with your inputs once paid. Nothing is charged until you complete it.</p><a class="btn alt" href="/catalog">Keep shopping</a>`}
<form method="post" action="/cart/clear"><button class="btn alt" type="submit">Empty cart</button></form></div>` : `<a class="btn" href="/catalog">Browse the catalog</a>`}`;
  return page({ title: "Your cart — Qatom", eyebrow: "Qatom · Cart", heading: "Your cart", body, cfg });
}

export function bundleErrorPage({ problems, cfg }) {
  return page({
    title: "Couldn't build that checkout",
    heading: "Couldn't build that checkout",
    body: `<div class="err" role="alert"><p>Nothing was charged. Please check:</p><ul>${problems.map((p) => `<li>${p.id ? `<a href="/item/${Number(p.id)}">Item ${Number(p.id)}</a>: ` : ""}${esc(p.message)}</li>`).join("")}</ul></div><a class="btn alt" href="/catalog">Back to the catalog</a>`,
    cfg,
  });
}

export function exampleLink(item, cfg) {
  if (!buyability(item, cfg).ok) return null;
  const ex = cfg.examples[item.id] || {};
  const qs = new URLSearchParams();
  for (const f of fields(item.input_schema).filter((f) => f.required)) {
    const v = ex[f.name] ?? f.default ?? (f.enum ? f.enum[0] : undefined);
    if (v === undefined || sensitive(f)) return null;
    qs.set(f.name, String(v));
  }
  const s = qs.toString();
  return `${cfg.site}/buy/${item.id}${s ? "?" + s : ""}`;
}

// ---------- shared ----------

export function visible(items, cfg) {
  return items.filter((i) => !cfg.hidden.has(i.id));
}

export function search(items, q) {
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return items;
  return items
    .map((i) => {
      const name = String(i.name || "").toLowerCase();
      const hay = `${name} ${String(i.seller || "").toLowerCase()} ${String(i.description || "").toLowerCase()}`;
      if (!terms.every((t) => hay.includes(t))) return null;
      return { i, score: terms.filter((t) => name.includes(t)).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
}

// ---------- plain text for AI readers (headless: nothing here needs a browser) ----------

// Fields to ask for: the required ones; if the seller marked none, all of them (as the form does),
// except optional search filters on free items, which are fine to leave out.
function reqFields(item) {
  const fs = fields(item.input_schema);
  if (fs.some((f) => f.required)) return fs.filter((f) => f.required);
  return Number(item.price) ? fs : [];
}

function fieldLine(f) {
  return `${f.name}${f.required ? "" : " (optional)"}: ${f.description || f.type || ""}${f.enum ? ` [${f.enum.join(" | ")}]` : ""}`;
}

// How to buy this item, as one or two lines an assistant can act on without fetching anything else.
function buyLines(item, cfg) {
  const b = buyability(item, cfg);
  const req = reqFields(item);
  const ask = req.length ? `Ask the person for: ${req.map((f) => f.name + (f.enum ? ` (${f.enum.join(" | ")})` : "")).join(", ")}.` : "No inputs needed.";
  if (!b.ok) {
    const tpl = `${cfg.site}/bundle?item=${item.id}${req.map((f) => `&${item.id}.${f.name}=VALUE`).join("")}&item=OTHER_ID…`;
    return `${ask} Cart only (under ${price(cfg.minPrice)} alone): combine with other items so the total reaches ${price(cfg.minPrice)}: ${tpl}`;
  }
  const ex = exampleLink(item, cfg);
  const tpl = `${cfg.site}/buy/${item.id}${req.length ? "?" + req.map((f) => `${f.name}=VALUE`).join("&") : ""}`;
  return `${ask} Checkout link: ${req.length ? tpl : `${cfg.site}/buy/${item.id}`}${ex && req.length ? ` (example: ${ex})` : ""}`;
}

export function catalogText({ catalog, cfg, all = true, q = "" }) {
  let items = visible(catalog.items, cfg).filter((i) => all || buyability(i, cfg).ok);
  if (q) items = search(items, q);
  const lines = items.map((i) =>
    `- [${i.id}] ${i.name} — ${price(i.price)}${i.seller ? ` — ${i.seller}` : ""}\n  ${summary(i.description, 220)}\n  ${buyLines(i, cfg)}\n  Details: ${cfg.site}/item/${i.id}`);
  return `# Qatom catalog${q ? ` matching "${q}"` : ""} (${items.length} items, refreshed ${catalog.fetched_at || "recently"})
# Each entry says what to ask the person for and the checkout link to give them.
# Replace VALUE with the person's answers, URL-encoded. Card payments start at ${price(cfg.minPrice)} per checkout;
# "cart only" items are combined into one checkout with ${cfg.site}/bundle?item=ID&ID.input=VALUE&item=ID2&qty.ID2=N

${lines.join("\n\n") || "No items match."}
`;
}

export function itemText({ item, cfg }) {
  const fs = fields(item.input_schema);
  return `# ${item.name}
Item ${item.id} · ${price(item.price)}${item.seller ? ` · seller: ${item.seller}` : ""}

## How to buy (in the chat)
${buyLines(item, cfg)}
Give the person the finished link. It opens Qatom's checkout; nothing is charged unless they complete it.
Pass only the required inputs and the ones the person chose; optional inputs left out use the seller's defaults, and the checkout page lists every input you pass.
Tell the person before they pay: the answer appears on the checkout page after payment, and only there (not in the receipt email), so copy it or screenshot it before closing. Then: ${cfg.site}/result.txt
To check a link first without creating anything, fetch it: an AI fetch of a /buy or /bundle link returns a validation result, not a checkout.

## Description
${item.description}

## Inputs
${fs.map((f) => `- ${fieldLine(f)}`).join("\n") || "- none"}
`;
}

// What an AI fetcher gets from /buy or /bundle: a validation result, never a checkout.
export function checkText({ ok, link, title, total, problems = [], cfg, itemId = null }) {
  if (ok) {
    return `VALID — nothing was created or charged.
${title} · ${price(total)}

Give the person this exact link to pay (it opens Qatom's checkout, where they pay with Apple Pay, Google Pay or card):
${link}

Before they tap it, tell them: the answer appears on the checkout page after they pay, and only there (it is not in the receipt email), so copy it or take a screenshot before closing that page.

After they pay:
1. Ask them to paste the answer (or the screenshot) here, explain it in two or three sentences, and offer it as a file to keep if you can make files. If you can't, send them to ${cfg.site}/result${itemId ? `?item=${itemId}` : ""} to save it as JSON, Markdown or PDF (runs in their browser; nothing is sent).
2. Once, if this was their first Qatom purchase: offer to connect their AI to Qatom so next time the answer comes straight back into the chat. Steps per app: ${cfg.site}/connect.txt
`;
  }
  return `NOT VALID — nothing was created or charged. Fix these and build the link again:
${problems.map((p) => `- ${p.id ? `item ${p.id}: ` : ""}${p.message}`).join("\n")}

Item details and inputs: ${cfg.site}/item/ID (plain text)
`;
}

// What link-preview fetchers (iMessage, WhatsApp, Slack, ChatGPT's link cards…) get from a buy link.
export function previewHtml({ title, description, cfg }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:site_name" content="Qatom">
<meta name="description" content="${esc(description)}">
</head><body><h1>${esc(title)}</h1><p>${esc(description)}</p><p>Tap the link to pay on Qatom's checkout.</p></body></html>`;
}

export function errorText({ heading, message }) {
  return `# ${heading}\n\n${message}\n`;
}

// ---------- 1.3: before-you-pay page, keep-your-result page, connector page ----------

const SAVE_NOTE = "After you pay, your answer appears on Qatom's checkout page, and only there: it isn't in the receipt email. Copy it or take a screenshot before you close that page.";
export const saveNoteText = SAVE_NOTE;

function argList(args) {
  const e = Object.entries(args || {});
  if (!e.length) return "";
  const rows = e.map(([k, v]) => `<li><strong>${esc(prettyName(k))}</strong>: ${esc(typeof v === "object" ? JSON.stringify(v) : v)}</li>`).join("");
  return e.length > 3
    ? `<details><summary>Your inputs (${e.length})</summary><ul class="meta">${rows}</ul></details>`
    : `<ul class="meta">${rows}</ul>`;
}

// Shown to a person who tapped a /buy or /bundle link, one tap before Qatom's checkout.
export function confirmPage({ lines, total, goHref, resultHref, cfg }) {
  const body = `
${lines.map((l) => `<div class="card"><h3>${esc(l.name)}</h3>
<div class="meta"><span class="price">${price(l.price * (l.qty || 1))}</span>${l.qty > 1 ? ` · ${Number(l.qty)} × ${price(l.price)}` : ""}${l.seller ? ` · sold by ${esc(l.seller)}` : ""}</div>
${argList(l.args)}</div>`).join("")}
${lines.length > 1 ? `<div class="card"><h3>Total ${price(total)}</h3><p class="meta">One checkout for everything.</p></div>` : ""}
<div class="note" role="note"><p><strong>Before you pay: save your answer.</strong></p>
<p>${esc(SAVE_NOTE)}</p>
<p>Easiest: copy it from that page and paste it back into your AI chat, or into <a href="${esc(resultHref)}" target="_blank" rel="noopener">Keep your result</a> (opens in a new tab) to save it as a file (JSON, Markdown or PDF).</p></div>
<a class="btn" href="${esc(goHref)}">Continue to secure checkout · ${price(total)}</a>
<p class="meta">Opens checkout.m.todaq.net, Qatom's hosted checkout. Pay with Apple Pay, Google Pay or card (processed by Stripe). Nothing is charged unless you complete it.</p>`;
  return page({ title: "Before you pay — Qatom", eyebrow: "Qatom · Checkout", heading: lines.length > 1 ? `${lines.reduce((n, l) => n + (l.qty || 1), 0)} items in one checkout` : "Before you pay", body, cfg });
}

const CONNECT_APPS = [
  ["Claude", "On claude.ai (web) or the desktop app: Settings > Connectors > Add custom connector, URL https://mcp.m.todaq.net/mcp, then sign in to Qatom. It then works in the Claude phone app too."],
  ["ChatGPT", "On chatgpt.com (not the phone app), with developer mode on: Settings > Connectors > Create, URL https://mcp.m.todaq.net/mcp. Availability depends on your plan."],
  ["Grok", "At grok.com/connectors: New Connector > Custom, URL https://mcp.m.todaq.net/mcp."],
  ["Meta Muse", "No custom connectors yet. Keep using this storefront; it works the same way."],
];
const CONNECT_WHY = "With Qatom connected, your AI finds and buys items for you inside the chat, and the answer comes straight back into the conversation: no checkout page, nothing to copy. Every purchase still needs your approval, and your AI can only spend what you put in its own agent wallet.";

export function connectPage({ cfg }) {
  const body = `<div class="note"><p>${esc(CONNECT_WHY)}</p></div>
${CONNECT_APPS.map(([app, how]) => `<div class="card"><h3>${esc(app)}</h3><p>${linkify(how)}</p></div>`).join("")}
<p class="meta">The first time you connect, Qatom sets up your account and two wallets: your main wallet, and an agent wallet your AI spends from with your approval. Questions: <a href="mailto:support@todaq.net">support@todaq.net</a>.</p>
<a class="btn alt" href="/catalog">Back to the catalog</a>`;
  return page({ title: "Connect your AI to Qatom", eyebrow: "Qatom · Next time", heading: "Buy from inside your AI chat", body, cfg });
}

export function connectText({ cfg }) {
  return `# Connect an AI app to Qatom (optional, for repeat buyers)

Offer this once, after the person's first purchase through ${cfg.site}, and only if they'd like it.

${CONNECT_WHY}

${CONNECT_APPS.map(([app, how]) => `- ${app}: ${how}`).join("\n")}

Connector URL: https://mcp.m.todaq.net/mcp . Sign-in happens in the app's own connector screen; never ask for credentials in the chat.
`;
}

export function resultText({ cfg, item }) {
  return `# Keep a Qatom result${item ? `: ${item.name}` : ""}

The answer to a storefront purchase appears on Qatom's checkout page after payment, and only there (it is not in the receipt email).

If you are an AI helping the person:
1. Before they pay, tell them: copy the answer or take a screenshot before closing the checkout page.
2. After they pay, ask them to paste it (or the screenshot) here in the chat.
3. Explain it in two or three sentences, then offer it as a file to keep (Markdown, JSON or a table) if you can make files.
4. If you can't make files, send them to ${cfg.site}/result${item ? `?item=${item.id}` : ""} : they paste the answer there and can copy it, download it as JSON or Markdown, or save it as a PDF. It runs entirely in their browser; nothing is sent or stored.
5. Once, offer to connect their AI to Qatom so next time the answer comes straight back into the chat: ${cfg.site}/connect.txt
`;
}

// Runs only in the visitor's browser. Every value is placed with textContent; nothing is sent anywhere.
const RESULT_JS = String.raw`
(function(){
var $=function(id){return document.getElementById(id)};
var box=$('raw'),out=$('out'),acts=$('acts'),title=$('ttl'),status=$('st');
var data=null,md='',pretty='';
function unwrap(v){
  for(var i=0;i<4;i++){
    if(typeof v==='string'){var s=v.trim();if(/^[\[{]/.test(s)){try{v=JSON.parse(s);continue}catch(e){}}return v}
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      if(Array.isArray(v.content)&&v.content.length&&v.content.every(function(c){return c&&c.type==='text'})){v=v.content.map(function(c){return c.text}).join('\n');continue}
      if(v.structuredContent&&typeof v.structuredContent==='object'){v=v.structuredContent;continue}
      var k=Object.keys(v);if(k.length===1&&/^(result|data|output|fulfil?ment)$/i.test(k[0])){v=v[k[0]];continue}
    }
    return v}
  return v}
var UP={nav:1,usd:1,cad:1,id:1,url:1,api:1,pdf:1,etf:1,ai:1,tdn:1,qr:1};function label(k){k=String(k).replace(/_/g,' ').split(' ').map(function(w){return UP[w.toLowerCase()]?w.toUpperCase():w}).join(' ');return k.charAt(0).toUpperCase()+k.slice(1)}
function scalar(v){return v===null?'—':typeof v==='boolean'?(v?'Yes':'No'):String(v)}
function isFlat(o){return o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(function(k){var x=o[k];return x===null||typeof x!=='object'})}
function text(el,s){var n=document.createElement(el);n.textContent=s;return n}
function val(v){
  if(typeof v==='string'&&/^https:\/\/\S+$/.test(v)){var a=document.createElement('a');a.href=v;a.textContent=v;a.rel='noopener noreferrer';a.target='_blank';return a}
  return text('span',scalar(v))}
function render(v,depth){
  if(v===null||typeof v!=='object'){var p=text('p','');p.className='val';p.appendChild(val(v));return p}
  if(Array.isArray(v)){
    if(v.length&&v.every(isFlat)){
      var cols=[];v.forEach(function(r){Object.keys(r).forEach(function(k){if(cols.indexOf(k)<0)cols.push(k)})});
      var wrap=document.createElement('div');wrap.className='tw';var t=document.createElement('table'),tr=document.createElement('tr');
      cols.forEach(function(c){tr.appendChild(text('th',label(c)))});t.appendChild(tr);
      v.forEach(function(r){var row=document.createElement('tr');cols.forEach(function(c){var td=document.createElement('td');td.appendChild(val(r[c]===undefined?'':r[c]));row.appendChild(td)});t.appendChild(row)});
      wrap.appendChild(t);return wrap}
    var ol=document.createElement('ol');v.forEach(function(x){var li=document.createElement('li');li.appendChild(render(x,depth+1));ol.appendChild(li)});return ol}
  var dl=document.createElement('dl');
  Object.keys(v).forEach(function(k){dl.appendChild(text('dt',label(k)));var dd=document.createElement('dd');var x=v[k];
    if(x!==null&&typeof x==='object')dd.appendChild(render(x,depth+1));else dd.appendChild(val(x));dl.appendChild(dd)});
  return dl}
function cell(s){return scalar(s).replace(/\|/g,'\\|').replace(/\n/g,' ')}
function toMd(v,ind){
  ind=ind||'';
  if(v===null||typeof v!=='object')return ind+scalar(v)+'\n';
  if(Array.isArray(v)){
    if(v.length&&v.every(isFlat)){var cols=[];v.forEach(function(r){Object.keys(r).forEach(function(k){if(cols.indexOf(k)<0)cols.push(k)})});
      return '\n| '+cols.map(label).join(' | ')+' |\n| '+cols.map(function(){return '---'}).join(' | ')+' |\n'+v.map(function(r){return '| '+cols.map(function(c){return cell(r[c]===undefined?'':r[c])}).join(' | ')+' |'}).join('\n')+'\n\n'}
    return v.map(function(x){return (x!==null&&typeof x==='object')?ind+'-\n'+toMd(x,ind+'  '):ind+'- '+scalar(x)+'\n'}).join('')}
  return Object.keys(v).map(function(k){var x=v[k];
    return (x!==null&&typeof x==='object')?ind+'- **'+label(k)+'**:\n'+toMd(x,ind+'  '):ind+'- **'+label(k)+'**: '+scalar(x)+'\n'}).join('')}
function show(){
  var raw=box.value;if(!raw.trim()){status.textContent='Paste your answer first.';return}
  var v=unwrap(raw);data=v;out.textContent='';
  var head=title.value.trim()||'Qatom result';
  out.appendChild(text('h2',head));
  if(typeof v==='string'){var pre=text('pre',v);out.appendChild(pre);pretty=v;md='# '+head+'\n\n'+v+'\n'}
  else{out.appendChild(render(v,0));pretty=JSON.stringify(v,null,2);md='# '+head+'\n\n'+toMd(v)}
  md+='\n_Saved '+new Date().toISOString().slice(0,16).replace('T',' ')+' UTC from a Qatom purchase._\n';
  acts.hidden=false;status.textContent=typeof v==='string'?'Shown as text (it wasn’t JSON).':'Formatted. Save it before you close this page.'}
function fname(ext){return (title.value.trim()||'qatom-result').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)+'.'+ext}
function dl(content,type,ext){var b=new Blob([content],{type:type});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fname(ext);document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000)}
$('go').addEventListener('click',show);
box.addEventListener('paste',function(){setTimeout(show,0)});
$('paste').addEventListener('click',function(){if(!navigator.clipboard||!navigator.clipboard.readText){status.textContent='Long-press the box and choose Paste.';return}
  navigator.clipboard.readText().then(function(t){box.value=t;show()},function(){status.textContent='Long-press the box and choose Paste.'})});
$('cp').addEventListener('click',function(){var t=md;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){status.textContent='Copied. Paste it into your notes or your AI chat.'},function(){status.textContent='Select the text and copy it.'})}});
$('dj').addEventListener('click',function(){dl(typeof data==='string'?JSON.stringify({result:data},null,2):pretty,'application/json','json')});
$('dm').addEventListener('click',function(){dl(md,'text/markdown','md')});
$('pdf').addEventListener('click',function(){window.print()});
})();`;

export function resultPage({ cfg, item, nonce }) {
  const name = item ? item.name : "";
  const body = `<div class="note noprint"><p>Paste the answer from Qatom's checkout page below. It's shown formatted, and you can copy it or save it as a file.</p>
<p class="meta">This runs only in your browser. Nothing you paste is sent to us or stored anywhere.</p></div>
<div class="noprint"><label for="ttl">Name (optional)</label><input id="ttl" value="${esc(name)}" placeholder="e.g. GDXJ valuation, 22 Oct">
<label for="raw">Your answer</label><textarea id="raw" rows="7" placeholder='Paste here, e.g. {"ticker":"GDXJ", ...}'></textarea>
<button class="btn alt" id="paste" type="button">Paste from clipboard</button><button class="btn" id="go" type="button">Show it formatted</button>
<p class="meta" id="st" role="status"></p></div>
<div id="out"></div>
<div id="acts" class="noprint" hidden><button class="btn" id="cp" type="button">Copy as text</button>
<button class="btn alt" id="dj" type="button">Download JSON</button><button class="btn alt" id="dm" type="button">Download Markdown</button><button class="btn alt" id="pdf" type="button">Save as PDF</button>
<p class="meta">Save as PDF opens your phone's print screen: choose Save to Files (iPhone) or Save as PDF (Android).</p></div>
<div class="note noprint"><p><strong>Next time, skip this step.</strong> Connect your AI to Qatom and the answer comes straight back into your chat. <a href="/connect">How to connect</a></p></div>
<style>textarea{width:100%;font:14px ui-monospace,Menlo,monospace;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
#out dl{margin:8px 0}#out dt{font-weight:600;margin-top:10px}#out dd{margin:2px 0 0 0;padding-left:12px;border-left:2px solid var(--line);overflow-wrap:anywhere}
#out pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--mist);padding:12px;border-radius:10px}
.tw{overflow-x:auto}#out table{border-collapse:collapse;font-size:14px}#out th,#out td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
@media print{.noprint,.hero,footer{display:none!important}body{background:#fff;color:#000}}</style>
<script nonce="${esc(nonce)}">${RESULT_JS}</script>`;
  return page({ title: "Keep your result — Qatom", eyebrow: "Qatom · Your purchase", heading: "Keep your result", body, cfg });
}
