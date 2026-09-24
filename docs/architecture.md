# Architecture

## Layers

```
channels/         transport adapters — turn a platform-specific request
  simulator.ts     into (phone, text), and a reply back into that platform's
  twilio.ts        response format
                          |
                          v
core/              conversation logic — platform-agnostic
  engine.ts          session lookup + profile lookup + persistence
  stateMachine.ts     pure reducer: (session, text, ctx) -> (session, replies)
  intent.ts           free-text -> structured commands/queries (regex, always on)
  llmIntent.ts         optional LLM upgrade to the query parser (Groq, graceful fallback)
  messages.ts            reply copy (WhatsApp-formatted)
  session.ts               per-phone state, in-memory + JSON snapshot
                          |
                          v
domain/            business rules — no I/O, fully unit-testable
  catalog.ts          4-star filter, text search
  recommender.ts       weighted ranking + diversity constraint
  promos.ts             promo eligibility + discount math
  order.ts               cart/bill calculation
  delivery.ts             status-over-time simulation
  users.ts                 seeded user profiles + history
```

Each layer only depends on the one below it. `domain/` has zero knowledge of
HTTP, sessions, or WhatsApp — every function there is pure and takes plain
data in, plain data out, which is what makes 45 tests possible without a
running server for most of them.

## A message's journey

1. **Twilio** POSTs form-encoded `From`/`Body` to `/webhook/twilio/webhook`,
   or the **simulator** POSTs JSON `{phone, text}` to `/sim/message`.
2. The channel adapter normalizes both into `(phone, text)` and calls
   `core/engine.ts#processMessage(store, phone, text)`.
3. `engine.ts` loads (or creates) that phone's `Session` from the store, and
   resolves a `UserProfile` — a seeded profile with real order history for
   the three demo numbers, or a cold-start guest profile (empty history, no
   saved address) for anything else. If this is a fresh free-text search
   (session state `IDLE`, not a global command), it also awaits
   `llmIntent.ts#parseQueryWithLLM(text)` and passes the result through as
   `ctx.parsedQueryOverride` — see [The LLM intent layer](#the-llm-intent-layer) below.
4. `stateMachine.ts#handleMessage(session, text, {profile, now})` runs as a
   **pure function**: global commands (`MENU`/`HELP`/`STATUS`/`CANCEL`) are
   handled first regardless of state; everything else dispatches to the
   handler for the session's current state (`IDLE` → `AWAITING_SELECTION` →
   `AWAITING_QUANTITY` → `AWAITING_ADDRESS` → `AWAITING_PROMO` →
   `AWAITING_CONFIRM` → back to `IDLE` with an `Order` attached).
5. The new session is persisted; the reply strings go back through the
   channel adapter in its native format (TwiML `<Message>` verbs, or a JSON
   array).

Because step 4 is a pure function of `(session, text, ctx)`, the entire
happy-path-through-edge-cases test suite in `tests/stateMachine.test.ts`
runs with no server, no database, and no network — it just calls
`handleMessage` directly and asserts on the returned session and replies.

## The LLM intent layer

`core/intent.ts#parseQuery()` is a regex parser — it handles the assignment's
own example ("Veg Biryani") perfectly, but a sentence like *"something spicy
under 300, not too far"* passes straight through as the search string,
diluting relevance with tokens like "not" and "far".

`core/llmIntent.ts#parseQueryWithLLM()` optionally replaces that step. It
calls Groq's free-tier API (`openai/gpt-oss-20b`) with a strict JSON schema
response format, asking only for `{dish, vegOnly, maxPrice}` — no
conversation, no tool-calling, no state. For the sentence above it correctly
returns `{dish: "spicy", vegOnly: false, maxPrice: 300}`.

This is deliberately the smallest possible integration point:

- **`stateMachine.ts` is untouched in behavior.** `Ctx` gained one optional
  field, `parsedQueryOverride`; when absent, `handleIdle()` calls the same
  regex `parseQuery()` as before. The state machine stays a pure,
  synchronous function — all 12 of its tests still run with zero network
  and zero awareness that an LLM exists.
- **`engine.ts` is the only place that became `async`**, and only awaits the
  LLM for a fresh `IDLE`-state search — never for global commands, never for
  the five other conversation states.
- **Every failure mode returns `null`, never throws**: no API key, a
  network error, a timeout (4s), a non-200 response, or output that fails to
  parse as the expected JSON shape all fall back to the regex parser
  silently. `engine.ts` doesn't need its own error handling for this - a
  `null` from `parseQueryWithLLM()` and an omitted `parsedQueryOverride` are
  the same thing to `handleIdle()`.
- **Tests never touch the network.** `tests/setup.ts` clears
  `GROQ_API_KEY` before any test file's imports run (Node's
  `process.loadEnvFile()` never overrides an already-set variable, so this
  reliably wins over a real key in `.env`); `llmIntent.test.ts` covers the
  response-parsing logic directly via the exported `extractParsedQuery()`
  helper, without a live call.

In short: the ranker, the promo engine, the state machine, and 45 of the 51
tests have no idea an LLM is involved. It's an optional preprocessing step
that either produces a better query or gets out of the way.

## The recommender

`domain/recommender.ts` hard-filters to `rating >= 4.0`, then scores every
remaining match:

| Signal | Weight | What it captures |
| --- | --- | --- |
| Rating | 0.30 | Normalized 4.0–5.0 → 0–1 |
| History affinity | 0.30 | Recency-decayed (30-day half-life) weight from past orders at this restaurant/dish/cuisine, scaled by how highly the user rated that past order |
| Query match | 0.20 | Token overlap between the search text and the dish's name/tags/cuisine |
| Delivery ETA | 0.10 | Faster restaurants score higher |
| Price fit | 0.10 | How close the price is to the user's typical spend |

A diversity constraint then keeps at most one dish per restaurant, so the
three results returned are three genuinely different choices rather than
three items from the same kitchen. Every result carries a human-readable
`reason` string built from whichever signal contributed most — that's the
"you've ordered here 3× before · 4.6★ · 28 min" line the user sees.

## The promo engine

`domain/promos.ts` evaluates every promo against an order and returns the
single largest eligible discount, checking (in order): expiry, first-order-only,
per-user usage limit, minimum order value, restaurant scope, cuisine scope.
Every rejection carries a specific, user-facing reason — that string is what
gets sent back over chat, not a generic "invalid code."

## Delivery status

`domain/delivery.ts` computes an order's status as a pure function of
`(placedAt, now)` against a fixed timeline (CONFIRMED → PREPARING →
OUT_FOR_DELIVERY → DELIVERED over 90 seconds, compressed from a real
30–60 minute delivery so a demo doesn't require waiting). The simulator
polls this every 2 seconds over Server-Sent Events
(`GET /sim/orders/:id/stream`) to drive the live tracker in the browser UI.
