# Qatom Consumer

Buy from the [Qatom](https://qatom.ai) catalog with any AI, from any phone, with nothing to set up.

Most people use an AI app but will never add an MCP connector to it, whether for technical or personal reasons. This repository is for them: a storefront any AI can read and hand back a checkout link from, a skill that turns an AI into a good buyer's helper, and the prompts the Qatom team sends people at events when they ask "Can I try it?".

## Try it

Tell any AI app (Claude, ChatGPT, Grok, Meta Muse):

> *Please read https://try.agentkepler.tech and help me buy something from the Qatom catalog. Don't pay for me; give me the checkout link and I'll pay myself.*

Or open https://try.agentkepler.tech in a phone browser. No AI needed.

## Install the skill

```bash
npx skills add StarwaterHeaven/Qatom-Consumer --skill qatom-consumer
```

Then ask your agent: *"Find me something on Qatom for…"* or *"Help me try a $1 purchase on Qatom."* Or paste [`skills/qatom-consumer/SKILL.md`](skills/qatom-consumer/SKILL.md) into a project's instructions.

## What's inside

| Path | What it is |
|---|---|
| [`skills/qatom-consumer/SKILL.md`](skills/qatom-consumer/SKILL.md) | The buyer skill: storefront path with no setup, connected path with the Qatom tools, combining small items into one checkout, connector notes per app |
| [`storefront/`](storefront/) | The Cloudflare Worker behind try.agentkepler.tech: the whole public catalog, item pages with input forms, Qatom carts, `/bundle` links an AI can build, plain text for AI readers. Deploy and live-test steps are in its [README](storefront/README.md) |
| [`prompts/event-prompts.txt`](prompts/event-prompts.txt) | One message per AI app (Claude, ChatGPT, Grok, Meta Muse) for the team to text someone in person; they paste it into their AI and are buying in about a minute |

## How the storefront works

- It reads the live public catalog from the Qatom master MCP (every merchant, refreshed every 5 minutes), so new items appear with no change here.
- It only ever lists the catalog and creates guest checkouts. The buyer pays on Qatom's own checkout page (checkout.m.todaq.net); the storefront never spends money and never sees card details.
- Card payments start at $0.50. Items that cost less, including the many priced at a fraction of a cent per call, go into a Qatom cart and are paid together once the total reaches $0.50. No checkout link is issued below that.
- Inputs are checked against each item's own schema before a checkout is created. Personal details go through a form, not a link.

`cd storefront && npm install && npm test` runs 39 checks against a mocked Qatom loaded with a snapshot of the live catalog.

## Money safety

Nothing here pays for anyone. On the storefront, the person completes and pays for each purchase themselves. With the Qatom connector, every purchase needs the person's approval, and an agent can only spend what is in its own agent twin; it has no access to the person's primary wallet or to the card and bank gateways.

## Related

- Selling on Qatom: [qatom-seller-guide](https://github.com/StarwaterHeaven/qatom-seller-guide)
- A setup recipe for every kind of business: [qatom-use-cases](https://github.com/StarwaterHeaven/qatom-use-cases)
- How listings are scored: [Qatom Scorecard](https://github.com/StarwaterHeaven/Qatom-Review-and-Rating-System)
- Qatom: https://qatom.ai · support and refunds: support@todaq.net

## Contributors

- **Starwater** ([@StarwaterHeaven](https://github.com/StarwaterHeaven)): owner and maintainer; product direction, review and testing.
- **Wizard Kepler** (Team Kepler AI agent): build and documentation.

## About

Published by StarwaterHeaven and Wizard Kepler. MIT licensed. See [CHANGELOG.md](CHANGELOG.md).
