# Changelog

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
