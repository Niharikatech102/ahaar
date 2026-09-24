# WhatsApp Food-Ordering Bot

A conversational food-ordering bot for WhatsApp. The user asks for a dish in plain
text, the bot filters the catalog to highly-rated options weighted by that user's
order history, recommends three, and carries the conversation through selection,
address confirmation, promo codes, payment and live delivery tracking.

> Built as a take-home assignment. Scope is a working demonstration of the flow and
> the ranking logic, not a production system - see [Scope and trade-offs](#scope-and-trade-offs).

## Status

Work in progress. Checkpoint 1 of 6 complete: project scaffold and health endpoint.

## Why two channels

The conversation engine is transport-agnostic. A single `Channel` adapter interface
feeds it from either side:

- **Twilio WhatsApp Sandbox** - real messages on a real WhatsApp number.
- **Local simulator** - a WhatsApp-style browser UI that needs no credentials,
  no phone number and no public tunnel, so the full flow can be demonstrated on
  any machine.

Both paths run identical business logic.

## Quick start

```bash
npm install
cp .env.example .env     # optional; defaults work for the simulator
npm run dev
```

Then check the server is up:

```bash
curl http://localhost:3000/health
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the test suite |

## Configuration

All settings are optional for simulator-only use. See `.env.example` for the full
list; Twilio credentials are only needed to send and receive on real WhatsApp.

## Scope and trade-offs

- Catalog, user history and promos are JSON fixtures, not a database.
- Sessions are held in memory with a JSON snapshot on disk; a real deployment
  would use Redis so state survives restarts and scales past one process.
- Payment is simulated. No gateway integration, no card data is handled.
- Delivery status is a timed simulation rather than a rider-tracking feed.

## License

Unlicensed take-home assignment code.
