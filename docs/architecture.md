# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |
| Module checks | `specs/module-N/`, `scripts/check.mjs` | Each module's spec, instructions, rubric and acceptance tests; `npm run check` runs them |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`, except where a module has
   moved it to a database: Module 2 part 2 moves stock to a Supabase
   `inventory` table, read through `lib/copper/inventory.ts`. Facts that don't
   change daily (prices, colors) stay in the files.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 2: Ask Copper, the shopping chatbot

**Summary:** A floating chat panel on the landing page answers price, total and
stock questions by calling tools instead of guessing, and shows each step as it
happens.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/page.tsx` | Mounts the panel and passes `isAiConfigured()` to it. No new routes |
| Components | `components/copper/ask-copper.tsx`, `ask-copper-steps.tsx` | The panel, two separate chats (tools on / off), and the stations that draw each answer |
| Tools | `lib/copper/assistant/tools.ts` | `get_products`, `get_prices`, `calculate_cost`, `check_availability`: read-only, with zod input contracts |
| Instructions | `lib/copper/assistant/instructions.ts` | Copper's system prompt, sent only when tools are on |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()` streams the answer and returns a live `Progress` |
| Data | `lib/copper/data/inventory.json` | Stock list, read fresh by `check_availability` |
| AI calls | `lib/ai/call.ts` (module 2, `ask-copper`) | Gemini through `callStream`, with thought summaries; up to 5 steps |

**Data flow:** shopper question → panel → `askCopper()` → `callStream` → model
asks for a tool → tool runs in our code (catalog or stock list) → result goes
back to the model → reply. Each stream part updates a `Progress` that the panel
reads with `readLive()`.

**Decisions and trade-offs:** Prices, math and stock come from code, not from
the model, so they can't be invented. With tools off the model gets no
instructions and no tools, which is what makes the comparison honest. The two
chats keep separate histories so the tools-off model can't copy a tools answer.

**Risks and open questions:** Without tools the model invents prices, so that
chat is labeled as possibly made up. The tools only read, so a bad tool call
can't change anything. If the stock list can't be read, the tool says so
instead of guessing. Every question is logged to `ai_calls` for cost.

## Module 2 extension: delivery estimates

**Summary:** Ask Copper gets a fifth tool, `estimate_delivery`, so shoppers can
ask "when would it arrive?" and get a date window worked out in code, not
guessed by the model.

| Piece | Where | What it does |
|---|---|---|
| Tool | `lib/copper/assistant/tools.ts` (`estimate_delivery`) | Takes a product, color and quantity (1 to 5); reads today's stock from the Supabase `inventory` table; returns the ship date and an earliest/latest arrival date |
| Label | `lib/copper/assistant/progress.ts` | "Estimating delivery", shown in the panel's tool menu and tool cards |
| Panel | `components/copper/ask-copper-steps.tsx` | The tool card shows the quantity sent, the stock pill, the restock date (if waiting), the ship date and the arrival window |
| Instructions | `lib/copper/assistant/instructions.ts` | Copper must use the tool for delivery dates and never work dates out itself |
| Tests | `tests/estimate-delivery.test.ts`, `tests/estimate-delivery-card.test.tsx` | In stock, back-ordered, partial stock, weekends, wrong color, contract, stock unreadable, stale restock date |

**Shipping rule (an assumption, not a Product Bible fact):** the Bible gives
stock and the next restock date but no shipping times, so the extension
assumes an order ships 1 business day after it can be filled and the carrier
takes 3 to 5 business days. Weekends are skipped; holidays are not. "Today" is
Arizona time. The rule lives in one constant, `SHIPPING_RULE`.

**Decisions and trade-offs:** If there aren't enough units for the whole
order, the whole order waits for the next shipment (no split shipments), which
keeps the answer simple. The tool reads stock itself rather than depending on
the model to call `check_availability` first.

**Risks and open questions:** If a restock date has already passed and stock
is still short, the tool says the date is unknown instead of inventing one.
If stock can't be read, it says delivery can't be estimated. Adding a fifth
tool means Module 2's AC-M2.8 ("exactly four tools") fails in this repo on
purpose; the graded `copper-m2` repo keeps four.
