# Changelog

## 1.3 — 22 October 2026

From the first live purchases: the answer appears only on Qatom's checkout page after payment, so a buyer who closes that page loses it.

- **"Before you pay" page.** A person tapping a `/buy` or `/bundle` link sees the item, seller, price and their inputs (folded away when there are more than three), with a reminder to save the answer, then one tap to Qatom's checkout. Nothing is created until they continue (`&go=1`). `CONFIRM_BEFORE_CHECKOUT = "off"` skips it.
- **Keep your result** (`/result`, `/result?item=ID`): paste the answer from the checkout page; it is shown formatted (lists, tables, links) and can be copied, or downloaded as JSON or Markdown, or saved as PDF. Runs only in the browser: script under a per-request nonce, `connect-src 'none'`, `form-action 'none'`, nothing sent or stored. Unwraps MCP-style results (`content[].text`) and JSON inside strings.
- **Connector page** (`/connect`, `/connect.txt`): why and how to connect Claude, ChatGPT or Grok to Qatom; Meta Muse has no route yet.
- **AI wording:** the guide (v3.1), VALID responses and item text tell the AI to warn about saving the answer before payment, bring it back into the chat and offer it as a file, and offer the connector once after a first purchase. Pass only required inputs and the ones the person chose, so the checkout page lists fewer. The false "emailed with the receipt" promise is gone everywhere.
- **Skill** `qatom-consumer` 1.2 and **event prompts** updated to match.
- 56 tests.

## 1.2 — 22 October 2026

Headless until checkout: the person stays in their AI chat until they tap the checkout link.

- **AI fetchers get plain text everywhere** (`/`, `/catalog`, `/item/ID`, errors): each item with what to ask the person for and its checkout link, ready to fill in.
- **AI fetch of a checkout link validates only**: VALID with the exact link, or NOT VALID with reasons. Nothing is created on Qatom.
- **Link previews never create checkouts**: iMessage, WhatsApp, Slack and similar get a preview card.
- **Wording**: the guide, the `qatom-consumer` skill (1.1) and the event prompts ask the AI to read, not browse, and to reply with the link in the chat.
- 49 tests.

## 1.1 — 22 October 2026

From the first live deploy, which lost its Qatom sign-in within seconds.

- **Storefront sign-in moved to a Durable Object.** Qatom rotates refresh tokens and revokes the whole sign-in if an old one is reused. Several Worker instances refreshing at once with the same token did exactly that. One Durable Object now holds the token and refreshes strictly one request at a time; the KV token store is gone. A test fires simultaneous first requests against a mock that revokes on reuse.
- **`/health` reports the cause** as JSON (never token values), and a revoked sign-in says how to sign in again.
- **Deploy script** has one fewer step (no KV namespace).

## 1.0 — 22 October 2026

First release, from the cold-start buyer work of 21 October 2026.

- **Skill:** `qatom-consumer`, formerly Shopper Cicero 1.2, renamed and rewritten without a persona. Leads with the no-setup storefront path; the connected path covers `guest_checkout`, `agent_checkout` and the cart tools; per-app connector notes for Claude, ChatGPT, Grok and Meta Muse.
- **Storefront** (try.agentkepler.tech): the whole public catalog, paged past 500 items and refreshed every 5 minutes; item pages with forms built from each item's input schema; Qatom carts and `/bundle` links so items under the $0.50 card minimum can be bought together; no checkout link below $0.50 on any path; plain text for AI readers; 39 tests.
- **Event prompts:** one message each for Claude, ChatGPT, Grok and Meta Muse.
