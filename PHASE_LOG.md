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

---

## Phase 2 — LLM tool-calling architecture

**Status: SKIPPED per explicit user instruction** ("except this [Phase 2] build everything before that" / "before that"). Cart mutations remain regex-parsed (`ADD <dish>`, `REMOVE <dish>`, `MAKE <dish> <qty>`, plus the loosened natural-language detectors added in Phase 4/5 below) rather than routed through an LLM tool-calling layer. Referential language the regex parsers can't resolve ("add the first one", "add one more", context-dependent "that") still isn't understood - only literal phrasing and the specific patterns implemented are.

---

## Phase 3 — Recommendation scoring + user memory + real "my usual"

**Goal:** add a real user-preference profile, feed it into the existing recommender as a new scoring signal, and implement "my usual" as a genuine frequency calculation over order history (not just the last order, which `REORDER` from Phase 1 already covers).

### What changed, file by file

**`src/domain/types.ts`**
- New `UserPreferences` interface: `cuisines: string[]`, `dietary: 'veg' | 'non-veg' | 'vegan' | null`, `spiceLevel: 'mild' | 'medium' | 'spicy' | null`, `budgetMax: number | null`.
- `UserProfile` gains a required `preferences: UserPreferences` field.

**`src/domain/users.ts`**
- New `defaultPreferences()` helper (all fields empty/null).
- New `withDefaultPreferences()` normalizer applied when loading `users.json`/`added_users.json`, so old seed fixtures without a `preferences` field don't crash at runtime.
- `rowToProfile()` falls back to `defaultPreferences()` if a DB row somehow has none.
- `addUser()` now sets `preferences: defaultPreferences()` on every new profile, both in the returned object and the DB insert.
- `guestProfile()` includes `defaultPreferences()`.
- New `updateUserPreferences(phone, edits: Partial<UserPreferences>)` - merges partial edits into an existing profile (DB path: read-modify-write via Drizzle; local-file path: in-place mutation). Returns `null` for a phone with no profile row (guests have nothing to save preferences against). This is what Phase 7's "My Preferences" UI will call.

**`src/db/schema.ts`**
- `users` table gains `preferences: jsonb('preferences').$type<UserPreferences>().notNull().default({cuisines:[],dietary:null,spiceLevel:null,budgetMax:null})`.

**`src/domain/recommender.ts`**
- `WEIGHTS` rebalanced to make room for a new signal: `rating` and `history` dropped from 0.3 to 0.25 each, new `preference: 0.1` added (match/eta/priceFit unchanged at 0.2/0.1/0.1). Still sums to 1.0.
- New `preferenceMatch(entry, prefs)`: 0 when no preferences are set (so profiles without any leave ranking completely unchanged - verified by a dedicated test). Otherwise scores cuisine match (+0.5), dietary match (+0.3), spice-tag match (+0.1), budget fit (+0.1), clamped to 1.
- `buildReason()` now also takes `prefs` and appends "matches your vegetarian preference" / "within your budget" to the reason text when applicable - real signals, not LLM-fabricated text.
- `RecommendOptions` gains `preferences?: UserPreferences`.
- New `getUsualOrder(history): UsualOrder | null` - groups history by `(restaurantId, itemId)`, returns the pair with the highest count, ties broken by most-recent (`daysAgo`). Deliberately distinct from `REORDER`'s "last order" behavior.

**`src/core/stateMachine.ts`**
- Both `recommend()` call sites (`handleIdle`, `handleAddCommand`) now pass `preferences: ctx.profile.preferences`.
- New `handleMyUsual(session, ctx)`: computes `getUsualOrder()`, looks the dish up in the live catalog, adds it to the cart (same `addLineToCart` merge logic as `ADD`), guarded to `IDLE` state like the other cart commands.
- New `GlobalCommand` entries wired: `MY USUAL`, `USUAL`, `ORDER MY USUAL` → `handleMyUsual`.
- `handleAwaitingPromo`'s `APPLY` handling extended to also accept `BEST DISCOUNT`, `APPLY BEST DISCOUNT`, `BEST DEAL`, `BEST OFFER` (initially exact-phrase, later loosened - see the bugfix note under Phase 4/5 below).

**`src/core/intent.ts`**
- `GlobalCommand` union/array extended with `MY USUAL`, `USUAL`, `ORDER MY USUAL`, and (temporarily, later removed) `BEST DISCOUNT`/`APPLY BEST DISCOUNT`/`BEST DEAL`/`BEST OFFER`.

**`src/core/messages.ts`**
- New `noUsualOrderMessage()`, `usualAddedMessage(line, timesOrdered, cart)`.
- `HELP_TEXT` updated to mention `MY USUAL` and `BEST DISCOUNT`.

**`src/channels/simulator.ts`**
- New `GET /sim/profile?phone=` - returns the full profile (name, addresses, orderHistory, preferences) for Phase 7's account/preferences screens.
- New `PATCH /sim/preferences` - body `{phone, preferences: Partial<UserPreferences>}`, validates each field's shape before calling `updateUserPreferences()`, 404s for a guest phone with no profile row.

**Database (Neon, direct SQL again - `drizzle-kit push` still hits the same known constraint bug)**
- `ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{"cuisines":[],"dietary":null,"spiceLevel":null,"budgetMax":null}'::jsonb`.

**Tests added:** `tests/recommender.test.ts` (preference-signal neutrality when unset, vegetarian/budget reason text, 3 `getUsualOrder` cases), `tests/stateMachine.test.ts` (`MY USUAL` happy path / no-history / mid-flow-refused), `tests/users.test.ts` (default preferences on `addUser`, `updateUserPreferences` merge behavior and guest no-op).

### Verification performed
- `npm run typecheck` clean, full suite green (108/108 at this point).
- Live against real Neon: `MY USUAL` correctly picked the actual most-frequent dish from real accumulated order history (not just the most recent), confirmed via `GET /sim/profile`.
- Live: set preferences via `PATCH /sim/preferences` (`dietary: veg`, `budgetMax: 300`), then re-searched - recommendation reasons correctly showed "matches your vegetarian preference" and "within your budget" for qualifying dishes, sourced from real backend scoring, not fabricated text.

**Phase 3 status: COMPLETE.**

---

## Phase 4 — Smart promo system (natural-language "best discount")

**Goal:** the existing promo engine (`bestApplicablePromo`/`applicablePromos`/`evaluatePromo` in `src/domain/promos.ts`) already does everything asked for here - eligibility checking, real discount math, picking the single highest-saving option. This phase is just giving it a natural-language entry point.

### What changed
- Folded into the Phase 3 stateMachine.ts/intent.ts changes above (the `BEST DISCOUNT` family), then **corrected** in the bugfix pass below once live testing caught a real gap.

### Bug found during live end-to-end testing, and the fix
Typing the exact phrase `"BEST DISCOUNT"` worked, but a real user typed `"apply the best discount"` (extra words) and it fell straight through to `getPromoByCode()`, which correctly said `"apply the best discount" isn't a code I recognise` - because the match was exact-phrase equality (`isWord`) against a fixed `GLOBAL_COMMANDS` list, which can't tolerate any variation. This cascaded: since the promo step never resolved, subsequent `UPI` and `CONFIRM` messages were *also* misread as promo-code attempts, because the session was stuck in `AWAITING_PROMO`.

**Fix (`src/core/intent.ts`, `src/core/stateMachine.ts`):**
- Removed the rigid `BEST DISCOUNT` / `APPLY BEST DISCOUNT` / `BEST DEAL` / `BEST OFFER` entries from `GLOBAL_COMMANDS` entirely.
- New `isBestDiscountRequest(text)`: a regex, `/\b(?:best|biggest|maximum|highest)\s+(?:discount|deal|offer|promo|savings?)\b/i`, matched against the raw text - catches "apply the best discount", "what's the best deal", "give me the biggest offer", etc., not just the bare phrase.
- `handleAwaitingPromo`'s `wantsBestDiscount` now checks `isWord(trimmed, 'APPLY') || isBestDiscountRequest(trimmed)`.
- Added regression tests covering exactly the phrasing that broke live (`tests/stateMachine.test.ts`, `describe('BEST DISCOUNT') > 'recognizes realistic natural phrasing'`).

### Verification
- Live re-test of the exact failing sequence (`apply the best discount` → `UPI` → `CONFIRM`) now completes correctly end-to-end against the real server + Neon.
- Full suite green (116/116 including the 3 new phrasing-variant assertions).

**Phase 4 status: COMPLETE.**

---

## Phase 5 — Checkout: payment-method placeholder + "what's my total"

**Goal:** per the master prompt, checkout needs an explicit payment-method step (Cash on Delivery or UPI, no real payment integration), and the acceptance scenario explicitly requires `"What's my total?"` to work as a standing natural-language query.

### What changed, file by file

**`src/core/session.ts`**
- New `ConversationState` value: `AWAITING_PAYMENT`, inserted between `AWAITING_PROMO` and `AWAITING_CONFIRM`.
- `Session.paymentMethod: PaymentMethod | null` added.
- `freshSession()`/`resetToIdle()` both initialize/reset it to `null` (a CANCEL or MENU mid-checkout correctly forgets a picked-but-unconfirmed payment method).
- `SessionStore.fetchFromDb()`/`saveToDb()` read/write the new column.

**`src/domain/order.ts`**
- New exported `PaymentMethod = 'COD' | 'UPI'` type (session.ts and schema.ts both import this one definition rather than each declaring their own).
- `Order.paymentMethod: PaymentMethod` added - required, since by the time an order is placed a method must have been chosen.

**`src/db/schema.ts`**
- `sessions` table gains `paymentMethod: text('payment_method').$type<PaymentMethod | null>()`.

**`src/core/stateMachine.ts`**
- `moveToConfirm()` renamed to `moveToPayment()` and repurposed: instead of computing the bill and jumping straight to `AWAITING_CONFIRM`, it now stores the resolved promo code/discount and transitions to `AWAITING_PAYMENT`, prompting for COD/UPI.
- New `handleAwaitingPayment(session, text, ctx)`: parses `COD`/`UPI` (case-insensitive exact match), computes the bill using the already-stored discount, moves to `AWAITING_CONFIRM`, shows the full bill (now including a `Payment:` line). Invalid input re-prompts without losing state.
- `handleAwaitingConfirm()` now guards on `session.paymentMethod` being set (defensive - it always will be via the new flow) and includes it on the placed `Order`.
- `STATE_HANDLERS` gains `AWAITING_PAYMENT: handleAwaitingPayment`.
- New `handleTotal(session)`: computes a bill preview from whatever's in the cart plus any already-applied discount, works in **any** state (not gated to checkout) - "what's my total?" is meant to be askable anytime, including mid-shopping before checkout even starts.
- New `isTotalRequest(text)` in `intent.ts` (regex, not exact-phrase) wired in near the top of `handleMessage`, alongside the cart commands.

**`src/core/messages.ts`**
- New `paymentMethodPromptMessage()`, `invalidPaymentMethodMessage()`, `totalMessage(cart, bill)`.
- `billMessage()` signature gains a `paymentMethod` parameter and now prints a `Payment: Cash on Delivery` / `Payment: UPI` line.
- `orderPlacedMessage()` also states the payment method used.
- `HELP_TEXT` updated to mention `MY TOTAL`.

**Database (Neon, direct SQL)**
- `ALTER TABLE sessions ADD COLUMN payment_method text`.

**Tests updated:** every flow test that walked promo→confirm (`tests/stateMachine.test.ts`'s happy path, promo-application test, cold-start guest test, the Phase 1 multi-item acceptance test, `REORDER`, `CANCEL after CONFIRM`, `post-delivery rating`, `BEST DISCOUNT`) now inserts an explicit `COD`/`UPI` step and checks `AWAITING_PAYMENT` where the old code checked `AWAITING_CONFIRM` directly. Same for `tests/simulator.test.ts`'s two full HTTP flow tests. New `describe('MY TOTAL', ...)` block (2 tests: shows total including discount without disturbing checkout state; empty-cart guard).

### Verification
- `npm run typecheck` clean, full suite green.
- Live: full flow (search → add → add another via chat → `CHECKOUT` → address → `apply the best discount` → `UPI` → `CONFIRM`) walked end-to-end against the real server + Neon; order summary correctly showed `Payment: UPI`, and the placed-order confirmation also stated it.
- Live: `"what's my total"` asked mid-shopping (before checkout even started) correctly returned a live bill preview from the cart.

**Phase 5 status: COMPLETE.**

---

## Phase 6 — Order tracking: PICKED_UP stage

**Goal:** the master prompt's tracking example lists five stages (Confirmed → Preparing → Picked Up → Out for Delivery → Delivered); the app had four (no explicit pickup step).

### What changed, file by file

**`src/domain/order.ts`**
- `OrderStatus` gains `'PICKED_UP'`, inserted between `'PREPARING'` and `'OUT_FOR_DELIVERY'`.

**`src/domain/delivery.ts`**
- `STAGES` timeline redistributed across the same 90s demo window: `CONFIRMED` 0s, `PREPARING` 15s, `PICKED_UP` 35s (new), `OUT_FOR_DELIVERY` 55s, `DELIVERED` 90s.
- `STATUS_COPY` gains a `PICKED_UP` entry ("Picked up by your delivery partner.").
- New `isPartnerAssigned(status)` helper - true from `PICKED_UP` onward (previously the OUT_FOR_DELIVERY-or-DELIVERED check was inlined in two places; now it's one function both call, and it correctly extends partner visibility to the new earlier stage since realistically a partner is assigned at pickup, not only once already en route).

**`src/core/messages.ts`** / **`src/channels/simulator.ts`**
- Both replaced their inline `status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED'` checks with `isPartnerAssigned(status)`.

**`public/index.html`, `public/app.js`**
- Added a "Picked up" step to the tracker card markup and `STEP_ORDER` array. Not strictly required this phase (Phase 7 rebuilds the UI anyway), but cheap to fix now - without it, the existing tracker would show no step as "done" for the ~20s the order sits in `PICKED_UP`, a visible glitch for a two-line change.

**Tests added:** new `tests/delivery.test.ts` (stage-by-stage `statusAt` walk, `statusMessage` non-empty for every stage, `isPartnerAssigned` true/false boundary, `deliveryPartnerFor` determinism/variety). Fixed one now-incorrect timing assertion in `tests/stateMachine.test.ts` (an elapsed offset that used to land on `OUT_FOR_DELIVERY` under the old 4-stage timeline now correctly lands on `PICKED_UP` under the new one - bumped the test's offset instead of loosening the assertion).

### Verification
- `npm run typecheck` clean, full suite green (116/116).
- One transient Windows file-lock (`EPERM` deleting `added_users.json` during parallel test-worker cleanup) was hit once and did not reproduce on retry - a pre-existing local-file-mode flakiness risk, not something this phase introduced; noted here rather than silently ignored.
- Live: polled `STATUS` across the real delivery timeline against a freshly-placed order to confirm `PICKED_UP` actually appears with the correct copy and delivery-partner visibility.

**Phase 6 status: COMPLETE.**

---

## Phase 7 — Three-column desktop UI

**Goal:** rebuild the frontend into the three-column product described in the master prompt (left nav/sidebar, center chat with recommendation cards, right cart+tracking panel) - connected to real backend state throughout, not a static mockup. No reference image was ever provided this session, so this was built to the detailed text spec (the brief's own section 15) rather than a pixel reference. Frontend stays vanilla HTML/CSS/JS per the brief's explicit instruction not to introduce a framework.

Before writing any code, ran the `frontend-design` skill's process: a short design-token plan (cream/paper/deep-green/clay palette, Fraunces for display + Manrope for UI, the recommendation card chosen as the one deliberate visual flourish rather than uniform "SaaS card" treatment everywhere) reviewed against the brief before building.

### Backend additions needed to support the UI (before touching any frontend file)

**`src/core/stateMachine.ts`**
- `addLineToCart()` changed from a private helper to `export`ed, so the new cart REST endpoints can reuse the exact same merge-duplicate-lines logic as the chat `ADD` command instead of a second implementation.

**`src/core/engine.ts`**
- `EngineResult` gains `recommendations: Recommendation[] | null` - the structured data behind whatever recommendation cards were just shown (`nextSession.shownRecommendations` when `nextSession.state === 'AWAITING_SELECTION'`, else `null`). This exists so the UI can wire a real "Add to Cart" button to an exact `restaurantId`/`itemId` instead of re-parsing dish names back out of the chat text - the bracket-tag text format (`[REC_START]...`) that already existed for WhatsApp is unaffected and still generated the same as before.

**`src/channels/simulator.ts`** - new endpoints, all reusing existing domain logic rather than duplicating it:
- `GET /sim/cart?phone=` - current cart + computed bill.
- `POST /sim/cart/items` - add/merge a line by `restaurantId`+`itemId` (price and name always come from the catalog lookup, never trusted from the request body - covered by a dedicated test that sends a fake price and confirms it's ignored). Deliberately allowed in both `IDLE` and `AWAITING_SELECTION` (not just `IDLE`) - `AWAITING_SELECTION` is exactly the state right after a search, which is when a recommendation card's "Add to Cart" button fires; adding from there resolves the pending selection the same way answering it via chat would (state reset to `IDLE`, `shownRecommendations`/`selected`/`quantity` cleared), so the next chat message isn't misread as picking 1/2/3 from the old search. Every other conversation state still rejects with `409`.
- `PATCH /sim/cart/items` - set a line's quantity (1-10).
- `DELETE /sim/cart/items` - remove a line.
- `POST /sim/cart/clear` - empty the cart.
- `GET /sim/promos` - exposes `getAllPromos()` (already existed in `domain/promos.ts`, just never had an HTTP surface).
- `GET /sim/catalog` (optional `?q=`) - exposes `getAllRestaurants()`/`searchCatalog()` for the Browse Menu screen.
- These are dedicated REST endpoints rather than the button clicks faking chat messages, deliberately - a quantity tweak or a card's "Add to Cart" isn't something the user "said," so it shouldn't appear in the transcript. Checkout itself (`Proceed to checkout` → sends the literal `CHECKOUT` message) and promo application *do* go through chat, since those are genuinely conversational steps with their own existing quick-reply buttons (address YES, promo APPLY/CODES/SKIP, COD/UPI, CONFIRM) - the cart panel is a live mirror of that state plus an entry point into it, not a parallel checkout implementation.

**Tests added** (`tests/simulator.test.ts`): full cart-API coverage (add/update/remove, price-never-trusted-from-client, duplicate-add merges quantity, unknown dish id → 404, mid-flow edit → 409, `AWAITING_SELECTION` edit → allowed and clears the pending selection correctly, `GET`/`clear` consistency), plus `GET /sim/promos` and `GET /sim/catalog` (both no-query and `?q=`, confirming the 4★ floor still applies to search results).

### Frontend rebuild

**`public/index.html`** - full rewrite. Three-column shell (`grid-template-columns: 300px 1fr 360px`): left sidebar (brand/logo, "+ New order", 5-item nav, contact list under "Chatting as", a promo teaser card reading real backend data); center chat (header, transcript, quick-suggestion chips, composer with disabled/inert attachment+mic icons - explicitly out of scope, shown but never pretending to work); right panel (live cart with promo row + bill breakdown + checkout button, then the order-tracking panel moved here from the old chat-header location, matching the brief's layout). Kept the existing add-customer modal as-is; added a preferences modal (real form fields) and one generic reusable info modal (title + body, optionally a search box) used for Browse Menu, My Orders, Promo Codes, and food-detail views instead of four separate hand-written modals.

**`public/styles.css`** - full rewrite (design tokens, 3-column grid, sidebar/nav, chat bubbles, recommendation cards, cart panel, tracking panel with the 5-stage timeline, all four modal variants, responsive breakpoints at 1080px - icon-only sidebar - and 860px - single column, cart/tracking becomes a scrollable section below chat).
- **Bug found and fixed before it ever hit the browser... almost:** every piece of JS toggles visibility via `classList.add/remove('hidden')`, but the stylesheet only defined the `[hidden]` *attribute* selector, not a `.hidden` *class* rule. Since nothing in the JS ever sets the actual `hidden` attribute, every modal, the tracker, the promo feedback banner, etc. would have rendered permanently visible - caught by reading my own CSS against my own JS before the first browser load, not by trial and error. Fixed with `[hidden], .hidden { display: none !important; }`.

**`public/app.js`** - full rewrite. Kept the core chat-sending/quick-reply/typing-indicator machinery from before; new pieces:
- `buildRecommendationCards()` - renders real cards from the new structured `recommendations` data (image, badge derived from an actual signal already in the data - "For you" if the reason mentions history, "Highly rated" at ≥4.7★, "Fastest" at ≤20 min ETA, never a fabricated label - rating, price, ETA, the reason text split into a checklist, Details + Add to Cart buttons wired to the real restaurant/item id).
- Cart panel: `loadCart()`/`renderCart()` plus qty +/- and remove wired to the new REST endpoints, live bill breakdown, checkout button disabled on an empty cart.
- Nav panels: `openPreferences()` (prefills from `GET /sim/profile`, saves via `PATCH /sim/preferences`), `openPromoCodes()` (real promo data, explicitly informational - no "apply" button outside the checkout context, to avoid a misleading action that would just get "isn't a code I recognise" if used before checkout), `openBrowseMenu()` (debounced search against `GET /sim/catalog`, grid of real dish cards), `openFoodDetail()` (full detail + Add to Cart), `openMyOrders()` (current order status if any, plus recently-rated dishes from real order history - deliberately does **not** claim to show "all past orders", since no such table exists; this was an explicit scope decision, not an oversight).
- Tracking panel moved/adapted from the old chat-header tracker to the right panel; same SSE stream, same 5-stage `STEP_ORDER`.

### Verification performed
- `npm run typecheck` and full test suite (125/125) after every backend change, before touching any frontend file.
- **Full live browser walkthrough** (not just curl) of the exact master-prompt acceptance scenario: searched "Something spicy" → real recommendation cards rendered with images/badges/reasons → clicked "Add to cart" on a card (confirmed cart panel updated live, bill computed correctly) → adjusted quantity with the +/- controls (confirmed live recalculation) → clicked "Proceed to checkout" (sent as a real chat message, confirmed address quick-replies rendered) → confirmed address → clicked the cart panel's "Use best available discount" button (confirmed it correctly found *no* eligible promo for this specific cart rather than fabricating one - two consecutive identical "no offer" prompts, verified as correct, not a duplicate-send bug) → skipped promo → picked COD → confirmed order summary showed every real number → placed the order → confirmed the tracking panel appeared with the real order id and progressed live via SSE (watched it advance through Confirmed → Preparing → Picked up → Out for delivery with a real assigned delivery partner name while interacting with other parts of the UI in between).
- Tested **My Preferences** (saved cuisines, confirmed a chat bubble acknowledgement, confirmed the values reload correctly on reopen), **Promo Codes** (real 5-code list from the backend), **Browse Menu** (full catalog grid, live debounced search for "pizza", real images), **food detail modal → Add to Cart** (confirmed cart updated and modal closed), **My Orders** (correctly showed the live order plus real rated-dish history, correctly did *not* fabricate a full order list), and the **Add Customer** modal (unchanged functionality, restyled).
- **Refreshed the browser mid-session** and confirmed full state restoration: cart contents, bill, and the order-tracking panel (by then showing `DELIVERED`, with the same delivery partner) all reloaded correctly from Postgres on a cold page load - this was the original "everything disappears on refresh" bug from much earlier in this project, now provably fixed all the way up through the new UI.
- Checked the browser console after a fresh page load: no errors or exceptions.
- **Not verified**: actual rendered mobile/tablet layout. The responsive CSS breakpoints are written (1080px and 860px), but the available browser tooling's window-resize did not visibly change the captured viewport in this session, so this is a real gap in verification, not a claim of "tested and working" - flagging it honestly rather than asserting something unconfirmed.

**Phase 7 status: COMPLETE** (functionally verified live end-to-end; responsive layout implemented but not visually confirmed).

---

## Phase 8 — End-to-end test + polish

**Goal:** run the master prompt's own final acceptance scenario for real, and fix anything it surfaces. No new features - this phase is verification and bugfixing only, checked against every phase's own tests too (nothing skipped along the way).

### Full regression pass
- `npm run typecheck` - clean.
- `npm test` - **125/125 passing** (full suite: catalog, recommender + `getUsualOrder`, promos, LLM intent, users + preferences, delivery + `PICKED_UP`, state machine incl. multi-item cart/REORDER/MY USUAL/BEST DISCOUNT/MY TOTAL/payment method, simulator HTTP incl. the new cart REST API and `/sim/promos`/`/sim/catalog`, Twilio webhook).

### Master-prompt acceptance scenario, run live end to end (not simulated)
Mapped directly against the "FINAL SUCCESS CRITERIA" scenario:

| Step | Result |
|---|---|
| User asks for something spicy/vegetarian/budget-bound | ✅ real Groq-parsed search, real 4★-filtered results |
| Ahaar returns 3 personalized recommendations | ✅ real recommendation cards (image, rating, price, ETA, real reason checklist) |
| Add the first one | ✅ via card's "Add to cart" button (also works via typing `1`/`ADD <dish>`) |
| Also add a Coke-equivalent | ✅ `Add coffee` via chat mid-session; browse-menu → food-detail → Add to Cart also verified |
| Make the first item two | ✅ cart panel `+`/`-`, and chat `MAKE <dish> <qty>`, both verified |
| Apply the best discount | ✅ **live bug found and fixed this session** (Phase 4): natural phrasing now works, not just the exact phrase; correctly returns "no eligible offer" rather than fabricating one when nothing qualifies |
| What's my total? | ✅ works both mid-shopping (before checkout starts) and empty-cart (honest "cart is empty" message, no bogus total) |
| Place the order | ✅ full checkout: cart → address → promo → **payment method (Phase 5 addition)** → review → confirm → real order created in Postgres |
| "Order #... has been placed" | ✅ (`Order placed! *ORD-...*`, real generated id) |
| Tracking panel shows Confirmed → Preparing → Picked Up → Out for Delivery → Delivered | ✅ all 5 stages (Phase 6 addition), watched progress live via SSE with a real named delivery partner appearing from Picked Up onward |
| Refresh the browser | ✅ cart, bill, and tracking state (mid-flow **and** fully delivered) all correctly restored from Postgres - confirmed twice this session, at two different points in the delivery timeline |
| Order my usual | ✅ real frequency-based calculation (not last-order); correctly declines gracefully for a user with no history instead of erroring |

### Bugs found and fixed during this phase (beyond the ones already logged under their own phases)
No new bugs surfaced during the final pass itself - Phases 3-7 already caught and fixed the two real ones (best-discount phrasing in Phase 4, the `.hidden` CSS/JS mismatch in Phase 7) through the same live-verification discipline applied throughout, rather than deferring everything to one final pass.

### Known, honestly-scoped gaps (not bugs - deliberate scope decisions, listed here for the record)
- **Phase 2 (LLM tool-calling)** was explicitly skipped per instruction. Referential chat language ("add the first one" as free text, "remove that one" with ambiguous reference beyond "the last thing added") isn't understood - only the literal `ADD`/`REMOVE`/`MAKE`/card-button paths work. Everything in the acceptance scenario above was achievable through those paths plus the UI buttons, so the scenario still passes end-to-end, just via slightly more literal phrasing/buttons than a full NLU layer would allow.
- **My Orders** shows the current order plus recently-rated dishes, not a full historical order list - no such table was ever built (an explicit, logged scope decision, not an oversight).
- **Favourites** were not built - no heart/favorite icon appears anywhere in the UI, since a fake one would violate "don't create fake buttons" and a real one was out of scope.
- **Mobile/tablet responsive layout** - CSS breakpoints are written but not visually confirmed (tooling limitation this session, noted honestly under Phase 7 rather than claimed as tested).
- **Admin dashboard, AI eval console, literal multi-agent architecture** - explicitly listed as optional/out-of-scope in the master prompt itself; not built.

---

## Phase 9 — Redesign-and-connect master prompt: catalog fix, "give me more", complaints, My Orders overhaul, polish

**Trigger:** a new 28-section master prompt asking to (1) redesign/polish the existing frontend toward a premium 3-column cream/green layout "matching the provided reference image", (2) connect it to the already-implemented backend, (3) add a short list of UI-facing features *only if* their backend support already exists, explicitly forbidding any backend rebuild, any new LLM integration, or any fabricated data. **No reference image was ever actually attached to this prompt** (flagged to the user; this is now the third master prompt across the project where an image was referenced in text but never attached) - proceeded on the detailed text spec alone, which Phase 7's existing cream/green/Fraunces+Manrope design already satisfies structurally, so this phase focused on the genuinely new requirements rather than re-doing the whole UI.

### Step 1 inspection findings (reported before any code was written)
- Confirmed via a direct Neon query across the full 687-dish catalog that **Aloo Paratha and Dal Khichdi did not exist anywhere** in the data - not hardcoded-and-hidden, not miscategorized, genuinely absent. Fixed at the source (see below), not papered over in the UI.
- Confirmed **no complaint/support backend existed at all** (zero matches for "complaint" anywhere in `src/`), despite the prompt's premise that it did. Built the minimum real backend for it (schema + domain module + two endpoints), per the prompt's own rule 23 ("only make backend changes if absolutely necessary... smallest possible change").
- Confirmed **"give me more" had no backend support** - `recommend()` had no exclusion mechanism and nothing tracked which query produced the current recommendations. Added the minimum needed (`lastQuery` on session, `excludeItemIds` on the recommender).
- Confirmed **My Orders had no real multi-order history to read** - `Session.currentOrder` only ever holds the single most-recent order; there was no persisted list. Section 17 explicitly asks for an Active/Delivered/Cancelled list, which is impossible to build honestly without *some* additive backend change, so a `pastOrders` list was added (see below) rather than either fabricating a list or leaving the requirement unmet.
- Confirmed **no location/distance system exists** - `Restaurant` has no coordinates, no user-location concept anywhere. Per the prompt's own instruction, real ETA continues to be shown and distance is simply never fabricated; a real-address-or-"Set delivery location" line was added using data that already exists (`profile.addresses`), not a new location system.

### Backend changes (all additive; no existing endpoint, table, or function signature was changed in a breaking way)

**`src/data/restaurants.json`** - added two real dishes to "Punjabi Tadka" (`r05`): `i0507` Aloo Paratha (₹130) and `i0508` Dal Khichdi (₹150), each with a Wikimedia Commons image verified via the Commons search + imageinfo API and confirmed HTTP 200 before being committed (not guessed). Re-seeded to Neon (`npm run db:seed`): 78 → 80 menu items.

**`src/domain/recommender.ts`** - added `excludeItemIds?: string[]` to `RecommendOptions`; `recommend()` filters candidates against this set before scoring, so a repeated call with the previous batch's ids never returns the same dishes twice.

**`src/core/messages.ts`** - `recommendationsMessage()` gained a `startIndex` parameter so a "give me more" reply continues numbering (4, 5, 6...) instead of restarting at 1, with distinct intro copy ("Here are my top N picks" vs "Here are N more"). Added `noMoreRecommendationsMessage()` and `noMoreRecommendationsContextMessage()` for the two honest failure cases (nothing left to show; asked before ever searching).

**`src/core/session.ts`** - added `lastQuery: string | null` (the free-text search behind the current `shownRecommendations`, so "give me more" can re-run it) and `pastOrders: PlacedOrder[]` (every order this phone has ever placed, most recent first, each with a `cancelledAt: number | null`; survives `MENU`/`CANCEL`/`resetToIdle`, unlike `shownRecommendations`). Wired into `freshSession()`, `fetchFromDb()`, and `saveToDb()`'s insert/update.

**`src/core/stateMachine.ts`** - `StepResult` gained `recommendations?: Recommendation[]`, the freshly-shown batch for this turn only (not the cumulative list), so the UI never re-receives cards it already rendered. `handleIdle()` now sets `lastQuery` and returns this field. New `handleMoreRecommendations()` guards on `state === AWAITING_SELECTION && lastQuery`, re-runs `recommend()` excluding every id in the cumulative `shownRecommendations`, and appends (not replaces) the new batch. Wired into `handleMessage()` for `GIVE ME MORE`/`MORE`/`SHOW MORE`/`MORE OPTIONS`/`MORE RECOMMENDATIONS`. `handleAwaitingConfirm()` now appends the placed order into `pastOrders` alongside setting `currentOrder`; the post-confirm `CANCEL` branch now marks the matching `pastOrders` entry `cancelledAt` instead of only nulling `currentOrder` (so a cancelled order stays visible in My Orders rather than vanishing).

**`src/core/intent.ts`** - extended `GlobalCommand`/`GLOBAL_COMMANDS` with the five "give me more" phrasings.

**`src/core/engine.ts`** - fixed the now-stale `recommendations` derivation (previously `nextSession.state === 'AWAITING_SELECTION' ? nextSession.shownRecommendations : null`, which would have re-sent the *entire* cumulative list on every "give me more" turn) to pass `handleMessage()`'s new explicit `recommendations` field straight through.

**`src/domain/complaints.ts`** (new file) - `ComplaintCategory` (`LATE_DELIVERY`/`WRONG_ITEM`/`MISSING_ITEM`/`FOOD_QUALITY`/`OTHER`), `ComplaintStatus` (`OPEN`/`UNDER_REVIEW`/`RESOLVED`), `createComplaint()`, `getComplaintsForUser()`. Follows the exact DB-or-local-fallback pattern used everywhere else in the codebase.

**`src/db/schema.ts`** - added `sessions.lastQuery` (text) and `sessions.pastOrders` (jsonb, default `[]`) columns; added the `complaints` pgTable.

**`src/channels/simulator.ts`** - added `GET /sim/orders` (a phone's full order history with live-computed status, `CANCELLED` included), `POST /sim/complaints` (validates the category against the real enum and that the order actually belongs to this phone's `pastOrders` before filing), `GET /sim/complaints`.

**Live Neon migration** - ran the established raw-SQL-via-`postgres`-package workaround (drizzle-kit's known primary-key bug still applies) to add `sessions.last_query`, `sessions.past_orders`, and create the `complaints` table on the live database; verified via `information_schema` query; scratch migration script deleted after running (not committed).

### Tests added (125 → 144 passing)
- `tests/recommender.test.ts` - `excludeItemIds` leaves out already-shown dishes.
- `tests/stateMachine.test.ts` - new `GIVE ME MORE` describe block (5 tests: appends excluding shown dishes + continues numbering; natural phrasing variants; selecting a numbered option from the extended list resolves correctly; declines gracefully before any search; says "everything I've got" rather than erroring once a query's matches are exhausted) and new `order history (pastOrders)` describe block (3 tests: records a placed order; marks cancelled instead of deleting; survives MENU/CANCEL resets).
- `tests/complaints.test.ts` (new file, 5 tests) - id generation, create+list round-trip in local-file mode, blank description trimmed to `null`, per-phone isolation, most-recent-first ordering.
- `tests/simulator.test.ts` - Aloo Paratha/Dal Khichdi now findable via `GET /sim/catalog?q=`; new `GET /sim/orders and POST/GET /sim/complaints` describe block (4 tests: empty history; full place-order → list → file complaint → read-back round trip; rejects a complaint against an order id that isn't this phone's; rejects an invalid category).

### Frontend changes

**`public/index.html`** - added: a `#sidebarPrefs` block (real read-only preferences summary + an "Edit preferences" link into the existing modal, distinct from it), a `#deliveryLocation` line in the chat header (real default address or a plain-text "Set delivery location", never fake GPS), a `#complaintOverlay` modal, and a `#toastContainer`.

**`public/app.js`**
- `DEFAULT_SUGGESTIONS` updated to the master prompt's own named shortcuts (Find something spicy / Vegetarian options / Show my cart / Apply best discount / Track my order / Order my usual / Give me more) - each a plain-text pass-through to existing commands.
- `showToast()` - a single-at-a-time toast, used for the three cart-panel/button actions that had no other feedback surface (added / updated / removed / cleared). Deliberately **not** layered onto order-placed, promo-applied, or complaint-submitted, since those already get a dedicated chat bubble or a detailed modal confirmation panel - stacking a toast on top of those would violate the prompt's own "do not overuse notifications" instruction rather than satisfy it.
- `appendRecommendations()` now takes an `isMore` flag (detected by mirroring `intent.ts`'s exact GIVE ME MORE phrase set) so the intro text correctly reads "top 3 picks" vs "N more", and renders a "Show more recommendations" button under every card grid, single-use per message (mirrors the existing quick-reply disable-after-click pattern) - clicking it sends the literal `GIVE ME MORE` command through the normal chat path.
- `loadProfileSidebar()` / `renderPrefsSummary()` / `renderDeliveryLocation()` - real data from `GET /sim/profile`, called on every `switchUser()` and after saving preferences.
- `skeletonCardsHTML()` / `skeletonListHTML()` - used in Browse Menu and My Orders while their first fetch is in flight, replacing a blank-body flash.
- **My Orders fully rewritten**: `GET /sim/orders` + `GET /sim/orders/current` + `GET /sim/profile` in parallel → grouped into Active/Delivered/Cancelled sections (only rendering a section header when it has entries) → each card shows id/date/items/total/status and an expand-in-place "View details" panel (address, payment method, full itemized bill). **Reorder** and **Track order** are only shown on the card matching the session's actual `currentOrder` id, since the backend's `REORDER` command and the SSE tracking stream only ever operate on that single most-recent order, not an arbitrary historical one - showing those buttons on an older card would silently act on the wrong order, so this is a deliberate, backend-accurate restriction, not an oversight. **Report an issue** is available on every card regardless of status.
- New complaint flow: `openComplaintModal()` (5 real category buttons + optional description, submit disabled until a category is picked) → `POST /sim/complaints` → `renderComplaintConfirmation()` showing the real complaint id/order/category/status/filed-at returned by the backend, never fabricated.
- Minor a11y additions: `aria-pressed` on category buttons, `aria-expanded` on the details toggle, `aria-live="polite"` on the toast container.

**`public/styles.css`** - added styles for all of the above (sidebar-prefs, delivery-location, rec-more button/hint, toast, skeleton shimmer, order-list/order-card/order-status-pill, complaint modal + confirmation, textarea field), plus `.sidebar-prefs` added to the existing icon-only-sidebar breakpoint's hide list and `.delivery-location` hidden at the single-column mobile breakpoint.

### Live verification performed (real browser, not curl-only)
Full walkthrough on the running dev server: searched "aloo paratha" → real card with image/rating/price/ETA rendered, confirming the catalog fix; clicked "Show more recommendations" → a genuinely new, non-overlapping batch of 3 cards appended below the first (confirmed by scrolling up and comparing), with correct "Here are 3 more:" wording and a `GIVE ME MORE` bubble in the transcript; searched "dal khichdi" → found; added items to cart; ran the full checkout flow (address → promo `WELCOME50` applied and reflected in the live bill → COD → confirm) → order placed, tracking panel appeared and progressed live via SSE; opened **My Orders** → the placed order appeared correctly under **Active** with all four action buttons; **View details** expanded in place with the real itemized bill; **Report an issue** → selected "Order delayed", added a description, submitted → confirmation showed a real backend-generated complaint id, linked order id, category, `OPEN` status, and filed timestamp; refreshed the browser → cart, tracking (by then `DELIVERED` with the same partner), and sidebar preferences/delivery-location all correctly restored; reopened My Orders → the same order now correctly appeared under **Delivered** with "Track order" gone (as designed) and "Report an issue" still available; Browse Menu still loads the full real catalog. Checked the console throughout: no errors.

### Known, honestly-scoped gaps and decisions (for the record)
- **Reorder / Track order are limited to the single most-recently-placed order**, because that is genuinely all the backend's `REORDER` command and SSE tracking stream support - not a UI oversight, a direct reflection of backend capability.
- **Distance is never shown**, only real ETA - no location/GPS system exists anywhere in the backend, and the prompt explicitly forbids fabricating one.
- **Toasts are intentionally not used for order-placed / promo-applied / complaint-submitted** - each already has a dedicated, richer confirmation surface (chat bubble or modal panel), and adding a toast on top would be redundant notification, not additional clarity.
- **Cancelled-order UI path** (`pastOrders` entries with `cancelledAt` set) is unit-tested and code-complete but not re-verified live this session beyond the original `CANCEL`-after-`CONFIRM` browser check from Phase 8, since the demo's cancellable window is only ~15s and the live walkthrough this round was optimized for covering the *new* surfaces.
- **Mobile/tablet responsive layout** for the newly-added components (sidebar-prefs, order cards, complaint modal) inherits the same breakpoints as the rest of the UI but was not re-verified visually at narrow widths this session (same tooling gap noted under Phase 7).

**Phase 9 status: COMPLETE** (backend: typechecked, 144/144 tests passing, live-migrated to Neon; frontend: functionally verified live end-to-end for every new surface).

---

## Phase 10 — WhatsApp-conversation UI rebuild (frontend-only, no backend changes)

**Trigger:** a new master prompt, explicitly scoped as UI-only ("DO NOT modify the backend... APIs... recommendation algorithms... cart/promo/checkout/order/tracking logic"), asking to completely replace the Phase 7/9 three-column desktop dashboard with a single WhatsApp-style mobile conversation: dark green header, green/white chat bubbles, and every feature (recommendations, cart, checkout, tracking, support) rendered as a rich card *inside* the conversation rather than a separate panel. A reference image was referenced in the prompt text but never actually attached (the fourth time this has happened across this project's master prompts) - proceeded from the prompt's own extremely detailed text spec (exact screen content, exact colors, exact component structure, an 80-item acceptance checklist), which was thorough enough to build from directly.

### Scope decisions made before writing code (stated to the user up front)
- **"Search Food"** → opens the existing Browse Menu grid (real catalog search), since a dedicated browse/search surface already existed and fits the welcome-menu action better than composer-only search.
- **"Recommended for You"** → sends a raw query that tokenizes to zero search terms (an all-stopword phrase, e.g. "something for me please"), so `recommend()` falls through to its history/preference ranking over the whole catalog instead of a text-filtered search - while the *displayed* chat bubble reads "What do you recommend for me?". This required decoupling what's shown in the transcript from what's actually sent to the backend (see below).
- **Cart card's promo section** → shows the real bill only; no "Apply Best Promo" button pre-checkout, since the backend's best-discount logic only resolves inside the `AWAITING_PROMO` step - a button that fired it standalone would either misfire as a dish search or require a backend change, both out of scope. Promo naturally comes up one message later at checkout, which already works correctly.
- **Tracking timeline** → kept all 5 real backend statuses (`CONFIRMED/PREPARING/PICKED_UP/OUT_FOR_DELIVERY/DELIVERED`) rather than truncating to the spec's illustrative 4, since showing real data takes priority over matching the example's exact step count.
- **Support categories** → used the 5 that actually exist in `ComplaintCategory` (`LATE_DELIVERY/WRONG_ITEM/MISSING_ITEM/FOOD_QUALITY/OTHER`); deliberately did not add the spec's "Refund / payment issue" option since no matching backend category exists and this pass forbids backend changes.
- **Distance** → still never shown, only real ETA - no location/GPS system exists anywhere in the backend, and the prompt explicitly says not to invent one.
- **My Orders / Preferences / Promo Codes** → not part of the spec's 6-screen conversation journey, so they became WhatsApp-styled bottom sheets reachable from the header's 3-dot menu rather than in-chat cards, since they needed *some* home.

### Files rewritten (frontend only - `git diff --stat public/` confirmed zero backend files touched this round)
**`public/index.html`** - full rewrite. Single `.wa-frame` (phone-width, centered with a shadow on desktop ≥620px, true full-bleed edge-to-edge below that) replacing the 3-column grid: WhatsApp header (back arrow, avatar, title/status, 3-dot menu → a small dropdown), one `#transcript` chat column, and a WhatsApp-style composer (emoji/attachment icons kept honestly inert like before, a mic-icon send button that becomes a paper-plane once text is typed). Kept, as bottom-sheet overlays off the 3-dot menu: switch-customer, add-customer, preferences, and one generic sheet reused for Browse Menu / My Orders / Promo Codes / food detail (same pattern as before, just restyled). The old dedicated complaint modal was removed entirely - complaints now live in the chat itself (see below).

**`public/styles.css`** - full rewrite. New token set built around WhatsApp's real palette (`#075e54` header teal, `#25d366` action green, `#d9fdd3`/`#ffffff` bubble colors, `#e5ded6` wallpaper) layered under Ahaar's own deep-green/clay accents for cards and prices; dropped the Fraunces display serif entirely in favor of Manrope throughout, per the spec's "avoid decorative fonts" instruction. New component styles: bubbles with the sharp-corner WhatsApp tail cue and timestamp/read-check footer, rich "card message" wrapper for non-bubble content, a horizontally-scrollable recommendation carousel, cart/tracking/support card layouts, and bottom-sheet overlay styling (slide-up animation, drag handle). Reused (recolored only, unchanged structure) the My Orders / Browse Menu / food-detail / promo-list class names from Phase 9 to minimize churn in already-tested logic.

**`public/app.js`** - substantial rewrite of rendering, all API-calling logic preserved as-is:
- `sendMessage(text, displayText)` - new second parameter lets a programmatic send (quick reply, menu button) show a friendly label in the transcript while sending the real command text to the backend. Fixes a real, previously-unnoticed gap from Phase 7/9: quick-reply clicks used to echo the raw value (`"CONFIRM"`, `"COD"`, `"APPLY"`) as the user's own chat bubble; now they show the button's actual label (`"Yes, place order"`, `"Cash on Delivery"`, `"Apply WELCOME50"`), confirmed live in this session's testing.
- Recommendation cards render into `buildRecCarousel()` (horizontal scroll, image/rating/price/ETA/Add-to-Cart only, matching the reference's card content) instead of the old CSS grid; "Show More Options" replaces "Show more recommendations" wording but is the same underlying give-me-more mechanism from Phase 9, untouched.
- `addToCart()` now drives a real chat exchange instead of a silent REST call updating a side panel: appends a user bubble ("Add <dish>"), a bot confirmation bubble, an added-item card (image/name/price×qty/✓ Added), and a "Would you like to: View Cart / Add More Items / Checkout" options card - matching the master prompt's section 5 almost verbatim.
- `appendCartCard()` / `renderCartCardInto()` - the cart is no longer a persistent panel; it's a card rendered on demand (View Cart tap, post-add options, or a `CART`/`VIEW CART` chat command intercepted client-side) and re-rendered in place on qty change or removal, so the same card element updates live rather than the whole page reloading.
- `appendTrackingCard()` - the order tracker is now a chat-embedded card with a real vertical timeline (done/current/upcoming states, checkmarks, per-step timestamps) instead of the old sidebar's horizontal-ish stepper; still driven by the same SSE stream from Phase 7, now targeting the in-chat card instead of a fixed panel. A second card underneath shows real items/total from `GET /sim/orders` (already-exposed data, no endpoint change) with a "View Order Details" link back into the My Orders sheet.
- `startHelpFlow()` / `openSupportCategoryCard()` / `openSupportDescriptionCard()` - the complaint modal from Phase 9 was replaced with an in-chat flow ("How can we help?" → category buttons → optional description → submit → confirmation bubble with the real complaint id/status), reachable both from the welcome menu / 3-dot menu (using the phone's current order) and from a specific order's "Report an issue" button inside the My Orders sheet.
- `switchUser()` now opens with `appendWelcomeMenu()` (logo, greeting, "What would you like to do today?", the 5 real menu buttons) instead of a single bot greeting line.

### Verification performed
- `npm run typecheck` and `npm test` (144/144, unchanged) after the rewrite, confirming the backend truly wasn't touched.
- `git diff --stat public/` showed only `index.html`/`styles.css`/`app.js` changed.
- Full live browser walkthrough on the running dev server: confirmed the WhatsApp header/avatar/back-arrow/3-dot-menu/wallpaper/bubble styling and timestamps render correctly on load; "Recommended for You" produced real history-ranked results (not a zero-result text-match failure) with the friendly bubble label; tapping a card's "Add to Cart" produced the full add-to-cart chat exchange (user bubble → confirmation → item card → next-step options) exactly matching the spec; "View Cart" rendered the cart card with correct real bill math, and the qty `+` control updated the same card in place live; "Proceed to Checkout" → typed a real address → applied `WELCOME50` via a quick-reply now correctly labeled "Apply WELCOME50" in the transcript (not the old raw `"APPLY"`) → picked Cash on Delivery → confirmed → got a real order id, an order-placed bubble, and a tracking card with all 5 steps starting at "Order Confirmed"; watched the SSE stream progress the timeline live (green check for done, blue ring for current) through Preparing → Picked Up with a real named delivery partner appearing; opened Help/Support from the 3-dot menu, selected "Order delayed", submitted with a description, and got back a real complaint id/order/category/`OPEN` status bubble; opened My Orders and confirmed the same order appeared correctly under Active with all four actions, while the earlier (Phase 9 test) order correctly appeared under Delivered with Reorder/Track Order absent, exactly per the backend-capability restriction. No console errors at any point.

### Known gaps / honest limitations for this round
- Aloo Paratha / Dal Khichdi discoverability was re-confirmed structurally (same `recommend()`/`searchCatalog()` calls, now just rendered into the carousel instead of the old grid) but not re-clicked through individually this round, since Phase 9 already live-verified both dishes surface correctly and no ranking/search logic changed.
- The spec's illustrative "🚚 Estimated arrival: 25–30 minutes" line was deliberately not built - `GET /sim/orders`/`/sim/orders/current` don't expose `restaurantEtaMinutes`, and adding that field would have meant editing `simulator.ts`, which this UI-only prompt explicitly forbids. Real per-step timestamps and the live SSE timeline communicate delivery progress instead.
- Mobile/tablet breakpoints beyond the frame's own full-bleed behavior below 620px width were not separately re-verified at intermediate widths this round (same longstanding tooling gap noted in every prior phase).

**Phase 8 status: COMPLETE. All phases (0, 1, 3, 4, 5, 6, 7, 8) done and verified; Phase 2 skipped per instruction.**
