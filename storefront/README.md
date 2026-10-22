# Qatom storefront — try.agentkepler.tech

A guest-checkout-only window onto the public Qatom catalog, so anyone whose AI app
can read a web page (Claude, ChatGPT, Grok, Meta Muse) can find and buy Qatom items
from a phone with no MCP connector. The person always pays on Qatom's own checkout
page; this Worker never spends money and never sees card details.

## How it works

- The Worker signs in to the main Qatom MCP (`https://mcp.m.todaq.net/mcp`) as a
  service account and calls only `catalog_search` and `guest_checkout`.
- `/catalog` and `/item/:id` render the public catalog (cached 5 minutes) as mobile
  pages and plain text for AI readers.
- `/buy/:id` validates inputs against the item's `input_schema`, mints a fresh guest
  checkout, and 303-redirects to `checkout.m.todaq.net` (no other host is ever
  allowed). Each tap makes a new session, because checkout links are single-use.
- Items under `MIN_GUEST_PRICE` (Stripe's $0.50 card minimum), including free ones,
  are bought through a **Qatom cart**: "Add to cart" on any item, one checkout link
  pays for everything once the total reaches the minimum. The cart lives in Qatom
  (`cart_*` tools); the storefront keeps only its id, in an HttpOnly cookie.
- `/bundle` lets an AI build a multi-item checkout as a single link.

| Route | What |
|---|---|
| `/` | Home: featured $1 item, how it works, AI note |
| `/catalog?q=&only=now` | Browse/search (default: everything) |
| `/item/:id` (`.txt`) | Item details, form, AI link format |
| `/buy/:id?input=…` (GET or POST) | Mint checkout and redirect |
| `POST /cart/add/:id` | Add an item with its inputs to the visitor's cart |
| `/cart` | Lines, total, remove, check out, empty |
| `/bundle?item=ID&ID.input=v&qty.ID=n…` | AI-buildable multi-item checkout |
| `/nav?ticker=` | Shortcut to the Harcourt NAV demo |
| `/llms.txt`, `/catalog.txt` | Plain text for AI readers |
| `/health` | Catalog reachable + item count |

## Deploy (about 5 minutes)

On a Mac or Linux machine with Node 20+, signed in to the Cloudflare account that holds
the agentkepler.tech zone (hassan.khan@todaqfinance.com):

```sh
git clone https://github.com/StarwaterHeaven/Qatom-Consumer
bash Qatom-Consumer/storefront/scripts/deploy.sh
```

It installs the tools, signs in to Cloudflare if needed, creates the token store,
deploys the Worker to try.agentkepler.tech, then opens your browser once so the
storefront can sign in to Qatom. Sign in as a dedicated account whose agent wallet
is empty (e.g. kepleragentteam@todaq.net): guest checkout never touches it, so even a
leaked token can't spend. It finishes by checking `/health`. Safe to re-run.

If the deploy says try.agentkepler.tech already has a DNS record, delete that record
in Cloudflare (DNS for agentkepler.tech) and run the script again; the Worker creates
its own.

Before anything else, check **Security > Bots / AI Crawl Control** on the zone:
if AI bots are blocked zone-wide, Claude and ChatGPT will be refused at the edge
and the whole flow fails. Allow user-triggered fetchers (Claude-User,
ChatGPT-User, etc.) at least for try.agentkepler.tech.

## Tests

`npm test` runs the real Worker in workerd (Miniflare) against a mocked Qatom
OAuth + MCP loaded with the live 84-item catalog snapshot: routing, schema
validation, escaping of hostile listings, token refresh/rotation, 401 retry,
seller-side rejections, redirect-host guard, rate limit, and the cart and bundle
flows against a cart mock shaped like live Qatom responses, the $0.50 checkout
guard, and catalog paging past 500 items. 39 checks.

## Proving it live (do in this order)

1. `/health` shows the real item count. (Proves sign-in + catalog.)
2. On a phone browser, open `/`, tap Buy for $1, pay. Confirm:
   the checkout shows Harcourt and $1.00; Apple Pay / Google Pay offered;
   **the NAV result appears after payment and in the receipt email.**
   This last point was not confirmed for guest checkout as of 15 Sep; if the
   result isn't delivered to the guest, everything else is moot.
3. A POST item with inputs: Centaur League "create a challenge" via the form.
4. A cart: add a few sub-cent calculators plus the $1 NAV item, check out once, pay.
   Confirm every item is delivered and the receipt lists each.
5. Each AI app on iPhone and Android with the Notes prompts. Time it; note where
   each app balks (fetch refused, won't give the link, wants to pay itself).
6. Watch `wrangler tail` for `checkout_failed` events.

## Settings (wrangler.toml `[vars]`)

- `MIN_GUEST_PRICE` — card minimum; lower it if Qatom aggregates small items.
- `HIDDEN_IDS` — test items kept off the storefront (now 20, 180, 215). Others that
  may be test listings: 2 Front Tire, 21 Apple Stock, 30 Unobtanium, 29 Digital Anvil.
- `FEATURED_ID` — item on the home page (24, Harcourt NAV).

## Notes for Matthew (making this a native Qatom feature)

What a first-party version would remove or improve:

1. **Public, unauthenticated catalog + guest checkout endpoints** (or a permanent
   pay link per item). Then no service account or token rotation.
2. **Hosted item pages on qatom.ai** generated from `input_schema`, like these.
   Trust is the biggest win: AIs check that the domain matches the brand.
3. **Result delivery to guests**: show the fulfilment on the success page and in
   the receipt, and give the buyer a link they can paste back to their AI.
4. **Cart minimum**: decide what the cart checkout does below $0.50 (a live cart for
   $0.001 got a checkout link on 21 Oct; whether the page can take that payment
   is unconfirmed). Also: `cart_add_item` accepted an argument outside the item's
   schema (`unit: "bad-unit"`); validating at add time would protect sellers.
5. **Merchant opt-out** of the public storefront per item (today it shows whatever
   `catalog_search` returns publicly).
6. Token rotation here is KV-based, which is fine for event traffic; a native
   version wouldn't need it.
