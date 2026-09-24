# Demo script

~2 minutes, covers every requirement in the assignment. Run `npm run dev` and
open http://localhost:3000 first.

## Setup

The sidebar contact list defaults to **Aryan**, who has ordered Veg/Chicken
Biryani from *Biryani House* and *Nawab's Kitchen* before — that history is
what makes the ranking visibly personalized in step 2.

## 1. Requesting an item

Type:

> Veg Biryani

**What to point out:** the catalog has "Veg Biryani" at five restaurants
rated 3.6 to 4.7★. Two of them (3.6★ and 3.8★) are silently excluded — that's
the *"filter options based on 4+ star ratings"* requirement working, not
just a display filter.

## 2. Filtering by rating and past history

The three results returned are:

1. **Nawab's Kitchen** — *"you've ordered this exact dish before"*
2. **Biryani House** — *"you've ordered this exact dish before"*
3. **Spice Junction** — *"matches your usual biryani orders"*

**What to point out:** click **Rohan** in the sidebar (no order history) and
repeat the search — the top two results stay Nawab's Kitchen and Biryani
House (driven by rating/ETA/price alone, no history signal available), and
the third slot changes to a restaurant that was previously outranked by
Aryan's order history. This shows the ranker degrades gracefully for a new
customer rather than breaking. Click back to Aryan to continue the flow.

## 3. Three relevant, distinct options

Exactly three results, one per restaurant (never two dishes from the same
kitchen) — the *"recommend three relevant options"* requirement.

## 4. Selecting and completing the order through delivery

Type each in turn:

```
1          -> selects Nawab's Kitchen Veg Biryani
2          -> quantity
YES        -> confirms the saved default address
```

**What to point out:** the address step already knows Aryan's saved
address ("12 MG Road, Bengaluru") from his profile — no re-typing needed.

## 5. Applying a promo / discount code

The promo prompt already shows an auto-suggested code — for this exact
order (2× Nawab's Kitchen Veg Biryani, ₹520 subtotal) it's **MEGA100**
(flat ₹100 off), picked automatically as the single largest discount the
user is eligible for out of all 6 seeded promos. Type:

```
APPLY
```

**What to point out:** typing a specific code instead (e.g. `BIRYANI20`)
works too and overrides the suggestion — try it on a re-run to show the bot
picks whichever code you name, not just its own suggestion. Typing an
invalid code (e.g. `FAKECODE`) shows a specific rejection reason rather than
a generic error.

## 6. Confirming and tracking delivery

```
CONFIRM
```

The order is placed, and a live status tracker appears above the chat,
progressing **Confirmed → Preparing → Out for delivery → Delivered** over
90 seconds via Server-Sent Events — no page refresh needed. Type `STATUS`
at any point to get the same status as a chat message (this is what happens
on real WhatsApp, where the bot can't push unsolicited updates).

## Bonus: LLM-powered query understanding

If a Groq API key is set in `.env` (free, no credit card — see the README),
type something noisier than a clean dish name:

> something spicy under 300, not too far

**What to point out:** the regex parser used by default would search on the
entire sentence verbatim. With the key set, an LLM call extracts
`{dish: "spicy", maxPrice: 300}` before it ever reaches the ranker — check
the results respect the ₹300 cap. Remove the key (or just don't set one) and
repeat the same message to show the graceful fallback: same reply shape,
slightly less precise filtering, nothing breaks.

## Bonus: real WhatsApp

If Twilio Sandbox is configured (see the main README), the identical flow
works by texting the sandbox number directly — same engine, same ranking,
same promo logic, just a different transport.

## Edge cases worth showing if there's time

- Type a nonsense dish (`asdkjasd`) → graceful "couldn't find a match" reply,
  no crash.
- Reply `99` at the selection step → re-prompts with the valid range instead
  of erroring.
- Type `CANCEL` mid-flow → resets cleanly back to a fresh search.
- Type `HELP` mid-flow → shows commands without losing your place in the order.
