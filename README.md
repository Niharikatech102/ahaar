# WhatsApp Food-Ordering Bot

A conversational food-ordering bot for WhatsApp. The user asks for a dish in plain
text, the bot filters the catalog to highly-rated options weighted by that user's
order history, recommends three, and carries the conversation through selection,
address confirmation, promo codes, payment and live delivery tracking.

> Built as a take-home assignment. Scope is a working demonstration of the flow and
> the ranking logic, not a production system — see [Scope and trade-offs](#scope-and-trade-offs).

## Try it in under a minute

```bash
npm install
npm run dev
```

Open **http://localhost:3000** — that's the whole demo. No Twilio account,
phone number, or `.env` file required. Pick a demo user from the dropdown
(each has different order history) and type "Veg Biryani", or just tap the
quick-action chips to click through the entire flow: search → select →
quantity → address → promo → confirm → live delivery tracking.

## Why two channels

The conversation engine (`src/core`) is transport-agnostic. `src/core/engine.ts`
is the single entry point both channel adapters call:

- **`src/channels/simulator.ts`** — powers the browser UI above. No credentials.
- **`src/channels/twilio.ts`** — a real webhook for Twilio's WhatsApp Sandbox,
  so the same bot also runs on an actual WhatsApp number.

Both call the exact same `recommend()`, `evaluatePromo()`, and `handleMessage()`
functions — nothing about the ordering logic is channel-specific. See
[`docs/architecture.md`](docs/architecture.md) for the full data flow.

## LLM-powered query understanding (optional)

By default, free-text search is parsed with a regex ("Veg Biryani", "paneer
under 250"). Add a free [Groq](https://console.groq.com/keys) API key (no
credit card) to understand messier input like *"something spicy under 300,
not too far"*:

```bash
cp .env.example .env
# fill in GROQ_API_KEY
```

If the key is missing, the request fails, or it times out, the bot falls
back to the regex parser automatically — nothing breaks either way. See
[The LLM intent layer](docs/architecture.md#the-llm-intent-layer) for how
this stays isolated from the rest of the (fully deterministic, fully
tested) ordering logic.

## Running it on real WhatsApp (Twilio Sandbox)

Optional — the simulator above is the complete demo. This is for showing the
same bot working on an actual phone.

1. **Join the sandbox.** In the [Twilio Console](https://console.twilio.com),
   open WhatsApp Sandbox settings and send the shown `join <code>` phrase from
   your WhatsApp to the sandbox number.
2. **Copy credentials.** From the console, get your Account SID and Auth Token.
3. **Configure:**
   ```bash
   cp .env.example .env
   # fill in TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
   ```
4. **Expose your local server** (Twilio needs a public URL):
   ```bash
   ngrok http 3000
   ```
5. **Point the sandbox webhook** at `https://<your-ngrok-subdomain>.ngrok-free.app/webhook/twilio/webhook`
   (Twilio Console → WhatsApp Sandbox Settings → "When a message comes in").
6. Message the sandbox number from WhatsApp — same conversation engine, real WhatsApp.

Signature validation is off by default (`TWILIO_VALIDATE_SIGNATURE=false` in
`.env.example`) since ngrok rewrites headers in a way that can fail it locally;
set it to `true` for anything beyond local testing.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the test suite (51 tests, always offline/deterministic) |

## Project layout

```
src/
  domain/     Pure business logic: catalog search, the recommender, promo
              engine, order/bill math, delivery-status simulation. No I/O,
              fully unit-tested.
  core/       Conversation engine: intent parsing (regex, optionally
              upgraded by an LLM), message templates, the state machine,
              session store, and the shared engine.ts entry point channels
              call into.
  channels/   Transport adapters: simulator (browser) and twilio (WhatsApp).
  server.ts   Express app wiring it all together.
public/       The browser simulator UI (vanilla HTML/CSS/JS, no build step).
tests/        Vitest suite — unit tests per domain module, plus full-flow
              integration tests over real HTTP for both channels.
docs/         architecture.md and demo-script.md.
```

See [`docs/architecture.md`](docs/architecture.md) for how a message flows
through these layers, and the recommender/promo scoring details.

## Demo script

See [`docs/demo-script.md`](docs/demo-script.md) for a script covering every
requirement in the assignment (4★ filter, history-based ranking, 3 recommendations,
selection through delivery, promo codes) in about two minutes.

## Configuration

All settings are optional for simulator-only use. See `.env.example` for the
full list; Twilio credentials are only needed to send and receive on real
WhatsApp.

## Scope and trade-offs

- **Catalog, user history and promos are JSON fixtures**, not a database —
  12 restaurants / 40 dishes / 3 seeded user histories / 6 promos, enough to
  exercise every code path without needing a persistence layer for a demo.
- **Sessions are in-memory** with a debounced JSON snapshot on disk purely so
  a dev-server restart doesn't lose an in-flight conversation. A real
  deployment would use Redis so state survives restarts and scales past one
  process.
- **Single-item cart.** The assignment describes selecting *one* option and
  completing the flow through delivery — this is one dish + quantity per
  order, not a multi-item shopping cart.
- **Payment is simulated.** No gateway integration, no card data is handled
  anywhere.
- **Delivery status is a timed simulation** (90 seconds end-to-end so a demo
  doesn't require waiting), not a real rider-tracking feed. The simulator
  pushes it live over Server-Sent Events; on WhatsApp the user checks with
  `STATUS`, since spontaneous business-initiated messages need a scheduled
  sender that's out of scope for this demo.
- **"First order" promo eligibility** is derived from a user having zero
  seeded order history, not a persistent flag — reasonable for a stateless
  demo, would need a real orders table otherwise.

## License

Unlicensed take-home assignment code.
