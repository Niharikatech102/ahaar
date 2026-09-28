# Ahaar platform build — phase log

Detailed, append-only record of every change made under the phased master-prompt rebuild (multi-item cart, desktop redesign, and everything after it). Each phase entry lists exactly what changed, file by file, plus how it was verified. Nothing here is summarized away — if a file was touched, it's listed.

---

## Phase 0 — Repository baseline

**Goal:** understand the existing repo before changing anything. No functional changes made.

**Findings:**
- Stack confirmed: Express + TypeScript, functional/pure state machine core, Neon Postgres via Drizzle, vanilla HTML/CSS/JS frontend (no framework), Groq LLM for search-query extraction only.
- Architecture map: `public/*` (frontend) → `src/channels/{simulator,twilio}.ts` (API) → `src/core/{engine,stateMachine,intent,llmIntent,messages,session}.ts` (core) → `src/domain/*.ts` (business rules) → `src/db/*.ts` (Postgres/Drizzle).
- Full feature matrix produced (existing/partial/missing per feature, mapped to files) — see conversation history for the complete table; condensed pointers are folded into each phase section below as they become relevant.
- Deployment: Vercel auto-detects the Express app via `export default app` in `src/server.ts` — no `vercel.json`/`api/` directory (deliberately removed in an earlier commit, `7737fbf`).
- **Verification:** `npm run typecheck` clean. `npm test` — 89/89 passing. Dev server boot smoke-tested: loaded 52 restaurants from Postgres, `/health` OK, `/sim/users` returned real Neon data.
- **Flagged (not fixed, not blocking):** 3 files had uncommitted local changes at the time (SSE-stream crash fix in `simulator.ts`, rating quick-reply buttons in `stateMachine.ts`/`stateMachine.test.ts`) — all part of the 89 passing tests, just not yet pushed.

No files modified this phase.

---

## Phase 1 — Multi-item cart backend

**Goal:** replace the single-item order model (`selected` + `quantity`) with a real persistent multi-item cart, entirely at the backend/chat level — no frontend UI work (that's Phase 2).

### What changed, file by file

**`src/domain/order.ts`**
- Added `cartSubtotal(cart: CartItem[]): number` helper.
- `computeBill()` now takes `CartItem[]` instead of a single `CartItem`, summing every line.
- `Order.cart` changed from `CartItem` (singular) to `CartItem[]`.
- `Order.restaurantEtaMinutes` doc comment updated: now the slowest ETA across every restaurant represented in the cart, not one restaurant's ETA.

**`src/db/schema.ts`**
- Added `cart: jsonb('cart').$type<CartItem[]>().notNull().default([])` column to the `sessions` table.
- Imported `CartItem` type from `domain/order.js`.

**`src/core/session.ts`**
- `Session.cart: CartItem[]` added — the persistent multi-item cart. `Session.selected`/`Session.quantity` are now explicitly documented as transient (only used while a single dish is mid-configuration, before it lands in `cart`).
- `freshSession()` initializes `cart: []`.
- `SessionStore.fetchFromDb()` / `saveToDb()` (both the insert `.values()` and the `onConflictDoUpdate` `.set()`) now read/write the `cart` column.
- `resetToIdle()` unchanged — it already spreads the rest of the session through, so `cart` correctly survives CANCEL/MENU (only the in-progress dish-configuration state is reset, not the accumulated cart).

**`src/core/intent.ts`**
- `GlobalCommand` union and `GLOBAL_COMMANDS` array extended with: `CART`, `VIEW CART`, `SHOW CART`, `MY CART`, `CHECKOUT`, `CLEAR CART`, `EMPTY CART` (all exact-phrase matches, reusing the existing single-token-equality infrastructure — array entries can contain spaces).
- New `parseAddCommand(text)`: matches `/^add\s+(?:a\s+|an\s+|the\s+|one\s+|some\s+)?(.+)$/i`, returns the dish query or `null`.
- New `parseRemoveCommand(text)`: matches `/^remove\s+(?:the\s+)?(.+)$/i`, returns the dish query or `null`.
- New `parseQuantityUpdateCommand(text)`: matches `/^make\s+(?:the\s+)?(.*?)\s+(\w+)$/i`, resolves a trailing word-or-digit count ("two" → 2, "2" → 2) via a small `WORD_NUMBERS` map (one–ten), returns `{ target, quantity }` or `null`. `target` is either a name fragment or the literal `"that"`.
- All three new parsers strip trailing punctuation first (`stripTrailingPunctuation`).

**`src/core/messages.ts`**
- `HELP_TEXT` rewritten to document the new commands (`ADD`, `REMOVE`, `MAKE`, `CART`, `CHECKOUT`, `CLEAR CART`) alongside the existing ones.
- `billLines()` split into `restaurantNames()`, `cartLineDescriptions()`, and a slimmer `billLines()` (fee/GST/total only, since per-line amounts now come from `cartLineDescriptions`).
- `billMessage(cart, bill, address)` signature changed from single `CartItem` to `CartItem[]`; now renders every line, a `Subtotal:` line, and a restaurant header that joins every unique restaurant name with `+` for mixed-restaurant carts.
- New message functions: `emptyCartMessage`, `cartMessage`, `itemAddedMessage`, `itemRemovedMessage`, `quantityUpdatedMessage`, `cartClearedMessage`, `cartBusyMessage`, `addItemNotFoundMessage`, `removeItemNotFoundMessage`.
- REORDER messages reworked for multi-item: `reorderItemUnavailableMessage` → `reorderNothingAvailableMessage` (only fires if literally nothing from the last order is available anymore); new `reorderAddedMessage(cart, addedCount, skippedNames)` replaces the old single-item `reorderMessage`.

**`src/core/stateMachine.ts`** (the core rewrite)
- `StepResult.ratingToRecord?: PastOrder` → `StepResult.ratingsToRecord?: PastOrder[]` (one rating entry per cart line in a multi-item order).
- New helpers: `cartLineFromSelection()` (replaces the old `buildCart()` — builds one line from a fully-configured selection), `addLineToCart()` (merges into an existing identical line — same restaurant+item — instead of duplicating it), `findCartLineIndex()` (fuzzy name lookup for REMOVE/MAKE), `cartOrderContext()` (aggregates promo-eligibility context across a possibly multi-restaurant cart: `restaurantId` is only set when every line shares one restaurant, `cuisines` is the union across every restaurant represented), `cartEtaMinutes()` (max ETA across every restaurant in the cart).
- `handleAwaitingQuantity()`: on a valid quantity, now pushes the line into `session.cart` (merging via `addLineToCart`) and returns to **`IDLE`** — it no longer jumps straight to `AWAITING_ADDRESS`. This is the core behavioral change of the phase: picking a dish now adds it to a standing cart instead of immediately starting checkout.
- New handlers: `handleAddCommand` (searches the catalog, adds the top match, qty 1), `handleRemoveCommand` (removes by fuzzy name match), `handleQuantityUpdateCommand` (updates one line's quantity, resolving `"that"`/`"it"` to the most-recently-added line), `handleViewCart`, `handleClearCart`, `handleCheckout` (guards on non-empty cart, transitions to `AWAITING_ADDRESS` — the exact tail that used to run automatically after quantity).
- `handleAwaitingAddress`, `moveToConfirm`, `handleAwaitingPromo` all switched from the old `buildCart(session)` (derived from `selected`+`quantity`) to operating on `session.cart` directly, using `cartOrderContext()` for promo eligibility instead of `session.selected.restaurant.cuisines`.
- `handleAwaitingConfirm`: builds `Order.cart` from the full `session.cart` array, `restaurantEtaMinutes` via `cartEtaMinutes()`, and **clears the cart** (`cart: []`) on successful confirm — the cart is "consumed" into the placed order.
- `handleReorder()` rewritten entirely: instead of re-selecting one dish and re-prompting for quantity, it now adds every line from the last order back into the current cart in one shot (skipping and naming any dish that's no longer in the catalog), staying in `IDLE` so the user can keep editing or check out immediately.
- `handleMessage()`: wired in the new `CART`/`CHECKOUT`/`CLEAR CART` global commands and the `ADD`/`REMOVE`/`MAKE` prefix parsers (checked after `REORDER`, before the pending-rating interceptor). The pending-rating handler now builds one `PastOrder` per cart line in `order.cart` (was one, for the single item) when a numeric rating is submitted.

**`src/domain/users.ts`**
- `recordOrderRating(phone, pastOrder: PastOrder)` → `recordOrderRatings(phone, pastOrders: PastOrder[])`, prepending every entry to the user's `orderHistory` in one update (DB path) or one in-memory splice (local-file fallback path). No-ops on an empty array or a guest phone with no profile row.

**`src/core/engine.ts`**
- Imports updated for the renamed `recordOrderRatings` and the new `parseAddCommand`/`parseRemoveCommand`/`parseQuantityUpdateCommand`.
- `isFreshSearch` gains an `!isCartMutationCommand` guard so an `ADD`/`REMOVE`/`MAKE` message never triggers a wasted Groq call (those are handled entirely by their own regex parsers in `stateMachine.ts`, which never consult `parsedQueryOverride`).
- Destructures `ratingsToRecord` (was `ratingToRecord`) from `handleMessage()`'s result and calls `recordOrderRatings(phone, ratingsToRecord)` when non-empty.

**`tests/stateMachine.test.ts`**
- `placeOrder()` helper updated to insert an explicit `CHECKOUT` step between quantity and address (matching the new lifecycle).
- Every existing flow test (happy path, promo application, invalid promo, cold-start guest, CANCEL, REORDER, CANCEL-after-CONFIRM, rating) updated for: `AWAITING_QUANTITY` → `IDLE` (with the item now in `session.cart`) instead of straight to `AWAITING_ADDRESS`; `order.cart` being an array (`cart[0]`) instead of a single object; `ratingsToRecord` (array) instead of `ratingToRecord`.
- REORDER tests rewritten for the new "adds everything back to cart, stays IDLE" behavior instead of the old "re-selects one dish, re-prompts for quantity."
- New `describe('multi-item cart', ...)` block, including the exact Phase 1 acceptance scenario from the master prompt (add pizza → add coffee → make the coffee two → remove pizza → cart contains only coffee ×2), a merge-duplicate-add test, `CART`/`CLEAR CART` tests, an empty-cart-checkout guard test, a mid-selection cart-command-refusal test, and a remove-not-in-cart test.

**`tests/simulator.test.ts`**
- Every HTTP-level flow test that walked search→select→quantity→address updated to insert an explicit `CHECKOUT` request between the quantity reply and the address reply (5 call sites: the full-details-customer test, the current-order test, the full HTTP order-flow test, the CANCEL test, and the promo-eligibility test).

**Database (Neon, direct SQL — not `drizzle-kit push`)**
- `ALTER TABLE sessions ADD COLUMN cart jsonb NOT NULL DEFAULT '[]'::jsonb`.
- Note: `drizzle-kit push` hit the same known bug encountered earlier (spurious `DROP CONSTRAINT ..._not_null` statements on primary-key columns that Postgres refuses) — bypassed with a direct, minimal `ALTER TABLE`, which is exactly what the schema change needed. No data loss; verified by reading `information_schema.columns` before and after.

### Verification performed

- `npm run typecheck` — clean.
- `npm test` — **95/95 passing** (89 pre-existing + 6 new multi-item-cart tests).
- Live, manual, end-to-end against the real dev server + Neon (not just unit tests):
  - Exact master-prompt acceptance scenario via chat text: `Add pizza.` → `Add coffee.` → `Make the coffee two.` → `CART` → `Remove pizza.` → `CART` — final cart contained exactly one line, the coffee, at quantity 2. Confirmed byte-for-byte against the expected outcome.
  - Full multi-restaurant checkout: added a second item from a different restaurant, ran `CHECKOUT` → address → `SKIP` promo → `CONFIRM`. Order summary correctly showed both restaurant names joined with `+`, both line items with correct per-line and aggregate totals (subtotal/delivery/GST/total math verified), and a real order was placed and confirmed via `STATUS`.
  - **Persistence across a full process restart** (the actual "refresh the page" test): added an item to a cart, killed the dev server process entirely, started a completely fresh process, and queried `CART` with no prior message — the item was still there, read back from Neon.
  - **REORDER** with a 2-item last order: correctly re-added both items to a fresh cart in one message (`"Added 2 items from your last order back to your cart."`).
  - **Rating flow** with a 2-item order: verified the rating prompt still fires exactly once at `DELIVERED`, and a numeric reply produces one `ratingsToRecord` entry per cart line (2 entries for a 2-item order) rather than silently dropping to one.
- Confirmed nothing else regressed: search, 4★ filter, promo codes (single and multi-item), delivery tracking, Groq/regex fallback, cancel-after-confirm, named delivery partner all still pass in the full suite and were re-exercised live.

**Phase 1 status: COMPLETE.**
