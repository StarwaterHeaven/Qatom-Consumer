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
<li>Your result is shown after payment and sent with the receipt. Paste it back to your AI if you'd like it explained.</li></ol>
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
<p class="meta">Buy now opens Qatom's hosted checkout for this item. Nothing is charged until you complete it.</p></form>`
    : `<h2>Add to cart · ${price(item.price)}</h2>${errBlock}
<form method="post" action="/cart/add/${item.id}">${fieldsHtml}
<button class="btn" type="submit">Add to cart</button>
<p class="meta">${b.reason === "free" ? "This item is free." : `At ${price(item.price)} per call this is below the ${price(cfg.minPrice)} card minimum on its own.`} Add it to your cart with other items and pay for everything in one checkout once the cart reaches ${price(cfg.minPrice)}.</p></form>`;

  const ai = `<h2>For AI assistants</h2><div class="note">
<p>Catalog item ${item.id} · ${esc(item.name)} · ${price(item.price)}${item.seller ? ` · seller ${esc(item.seller)}` : ""}.</p>
${b.ok ? `<p>Single-item checkout link (the person opens it and pays themselves): <code>${esc(cfg.site)}/buy/${item.id}${req.length ? "?" + req.map((f) => `${esc(f.name)}=VALUE`).join("&amp;") : ""}</code>${opt.length ? `. Optional: ${opt.map((f) => `<code>${esc(f.name)}</code>`).join(", ")}` : ""}. Values must be URL-encoded.</p>
${ex ? `<p>Ready-made example: <a href="${esc(ex)}">${esc(ex)}</a></p>` : ""}` : `<p>Too small to check out on its own (minimum ${price(cfg.minPrice)} per checkout); combine it with other items.</p>`}
<p>Several items in one checkout: <code>${esc(cfg.site)}/bundle?item=${item.id}${fs.length ? `&amp;${item.id}.${esc((req[0] || fs[0]).name)}=VALUE` : ""}&amp;item=OTHER_ID…</code> — repeat <code>item=ID</code> per item, prefix each input with its item ID, add <code>qty.ID=N</code> for quantities. The combined total must reach ${price(cfg.minPrice)}.</p>
${req.some(sensitive) ? `<p>This item needs personal details (${req.filter(sensitive).map((f) => esc(f.name)).join(", ")}). Prefer sending the person to this page to enter them in the form rather than putting them in a link.</p>` : ""}
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

// ---------- plain text for AI readers ----------

export function catalogText({ catalog, cfg, all = true }) {
  const items = visible(catalog.items, cfg).filter((i) => all || buyability(i, cfg).ok);
  const lines = items.map((i) => {
    const b = buyability(i, cfg);
    return `- [${i.id}] ${i.name} — ${price(i.price)}${i.seller ? ` — ${i.seller}` : ""}${b.ok ? "" : " — cart only (combine to reach " + price(cfg.minPrice) + ")"}\n  ${summary(i.description, 220)}\n  ${cfg.site}/item/${i.id}`;
  });
  return `# Qatom catalog (${items.length} items, refreshed ${catalog.fetched_at || "recently"})
# Items marked "cart only" are free or below the ${price(cfg.minPrice)} card minimum on their own: combine
# them with other items in one checkout link (${cfg.site}/bundle?item=ID&ID.input=VALUE&item=ID2…).
# Every other item also has its own checkout link; see its item page for inputs.

${lines.join("\n\n")}
`;
}

export function itemText({ item, cfg }) {
  const b = buyability(item, cfg);
  const fs = fields(item.input_schema);
  const ex = exampleLink(item, cfg);
  return `# ${item.name}
Item ${item.id} · ${price(item.price)}${item.seller ? ` · seller: ${item.seller}` : ""}
${b.ok ? `Checkout link format: ${cfg.site}/buy/${item.id}${fs.filter((f) => f.required).length ? "?" + fs.filter((f) => f.required).map((f) => `${f.name}=VALUE`).join("&") : ""}  (URL-encode values; the person opens it and pays)` : `Cart only: below the ${price(cfg.minPrice)} card minimum on its own.`}
In a multi-item checkout: ${cfg.site}/bundle?item=${item.id}${fs.length ? `&${item.id}.INPUT=VALUE` : ""}&item=OTHER_ID…  (combined total must reach ${price(cfg.minPrice)})
${ex ? `Ready-made example: ${ex}\n` : ""}${fs.some((f) => f.required && sensitive(f)) ? `Needs personal details; prefer sending the person to ${cfg.site}/item/${item.id} to enter them in the form.\n` : ""}
## Description
${item.description}

## Inputs
${fs.map((f) => `- ${f.name}${f.required ? " (required)" : ""}: ${f.description || f.type || ""}${f.enum ? ` [${f.enum.join(" | ")}]` : ""}`).join("\n") || "- none"}
`;
}
