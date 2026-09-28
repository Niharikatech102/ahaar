import { beforeAll, describe, expect, it } from 'vitest';
import { handleMessage, type Ctx } from '../src/core/stateMachine.js';
import { freshSession, type Session } from '../src/core/session.js';
import { getUserByPhone, guestProfile } from '../src/domain/users.js';
import { statusAt } from '../src/domain/delivery.js';
import type { UserProfile } from '../src/domain/types.js';

const PHONE = 'whatsapp:+15551230001'; // Aryan - has biryani history, one default address
const NOW_0 = 1_700_000_000_000;

// getUserByPhone is async (it goes through Postgres when DATABASE_URL is
// set), so this profile is fetched once up front rather than inside ctxAt -
// it never changes across these tests, only `now` does.
let cachedProfile: UserProfile;

beforeAll(async () => {
  cachedProfile = (await getUserByPhone(PHONE))!;
});

function ctxAt(now: number): Ctx {
  return { profile: cachedProfile, now, orderIdFactory: () => 'ORD-TEST-0001' };
}

function step(session: Session, text: string, now: number) {
  return handleMessage(session, text, ctxAt(now));
}

describe('full ordering flow: search -> select -> quantity -> cart -> checkout -> address -> promo -> confirm', () => {
  it('walks a happy-path transcript through to a placed order', () => {
    let session = freshSession(PHONE, NOW_0);

    // 1. Search
    let result = step(session, 'Veg Biryani', NOW_0);
    session = result.session;
    expect(session.state).toBe('AWAITING_SELECTION');
    expect(result.replies[0]).toContain('top 3 picks');
    expect(session.shownRecommendations).toHaveLength(3);

    // 2. Select option 1
    result = step(session, '1', NOW_0 + 1000);
    session = result.session;
    expect(session.state).toBe('AWAITING_QUANTITY');
    expect(session.selected?.item.name).toBe(session.shownRecommendations[0]!.entry.item.name);

    // 3. Quantity - this now adds the item to the cart and returns to IDLE, not straight to checkout
    result = step(session, '2', NOW_0 + 2000);
    session = result.session;
    expect(session.state).toBe('IDLE');
    expect(session.cart).toHaveLength(1);
    expect(session.cart[0]!.quantity).toBe(2);
    expect(result.replies[0]).toContain('Added');

    // 4. Checkout
    result = step(session, 'CHECKOUT', NOW_0 + 2500);
    session = result.session;
    expect(session.state).toBe('AWAITING_ADDRESS');
    expect(result.replies[0]).toContain('12 MG Road');

    // 5. Confirm default address
    result = step(session, 'YES', NOW_0 + 3000);
    session = result.session;
    expect(session.state).toBe('AWAITING_PROMO');
    expect(session.address).toBe('12 MG Road, Bengaluru 560001');

    // 6. Skip promo
    result = step(session, 'SKIP', NOW_0 + 4000);
    session = result.session;
    expect(session.state).toBe('AWAITING_CONFIRM');
    expect(result.replies[0]).toContain('Total: ₹');
    expect(session.appliedPromoCode).toBeNull();

    // 7. Confirm order
    result = step(session, 'CONFIRM', NOW_0 + 5000);
    session = result.session;
    expect(session.state).toBe('IDLE');
    expect(session.cart).toHaveLength(0); // cart is consumed into the order
    expect(session.currentOrder).not.toBeNull();
    expect(session.currentOrder?.id).toBe('ORD-TEST-0001');
    expect(result.replies[0]).toContain('Order placed');

    // 8. Immediately after placing, status is CONFIRMED
    result = step(session, 'STATUS', NOW_0 + 5500);
    session = result.session;
    expect(result.replies[0]).toContain('confirmed');

    // 9. Later, status progresses toward delivery
    const laterStatus = statusAt(session.currentOrder!.placedAt, NOW_0 + 5000 + 50_000);
    expect(laterStatus).toBe('OUT_FOR_DELIVERY');
  });

  it('applies a promo code end to end and reflects the discount in the bill', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    session = step(session, '3', NOW_0).session; // qty 3, pushes subtotal well above promo thresholds
    session = step(session, 'CHECKOUT', NOW_0).session;
    session = step(session, 'YES', NOW_0).session;

    const promoResult = step(session, 'BIRYANI20', NOW_0);
    session = promoResult.session;
    expect(session.state).toBe('AWAITING_CONFIRM');
    expect(session.appliedPromoCode).toBe('BIRYANI20');
    expect(promoResult.replies[0]).toContain('Applied *BIRYANI20*');
    expect(promoResult.replies.join('\n')).toContain('Discount (BIRYANI20)');
  });

  it('rejects an invalid promo code and stays in AWAITING_PROMO', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    session = step(session, 'CHECKOUT', NOW_0).session;
    session = step(session, 'YES', NOW_0).session;

    const result = step(session, 'NOTAREALCODE', NOW_0);
    expect(result.session.state).toBe('AWAITING_PROMO');
    expect(result.replies[0]).toContain("isn't a code");
  });
});

describe('global commands work in every state', () => {
  it('CANCEL resets an in-progress selection back to IDLE without touching the cart', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    expect(session.state).toBe('AWAITING_QUANTITY');

    const result = step(session, 'CANCEL', NOW_0);
    expect(result.session.state).toBe('IDLE');
    expect(result.session.selected).toBeNull();
    expect(result.session.cart).toEqual([]);
  });

  it('CANCEL with nothing in progress says so without erroring', () => {
    const session = freshSession(PHONE, NOW_0);
    const result = step(session, 'CANCEL', NOW_0);
    expect(result.session.state).toBe('IDLE');
    expect(result.replies[0]).toMatch(/not in the middle/i);
  });

  it('HELP does not disturb the current state', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    const result = step(session, 'HELP', NOW_0);
    expect(result.session.state).toBe('AWAITING_SELECTION');
    expect(result.replies[0]).toContain('How this works');
  });

  it('STATUS reports no active order before anything is placed', () => {
    const session = freshSession(PHONE, NOW_0);
    const result = step(session, 'STATUS', NOW_0);
    expect(result.replies[0]).toMatch(/don't have an active order/i);
  });
});

describe('invalid input handling', () => {
  it('an out-of-range selection re-prompts instead of crashing', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    const result = step(session, '99', NOW_0);
    expect(result.session.state).toBe('AWAITING_SELECTION');
    expect(result.replies[0]).toMatch(/1 to 3/);
  });

  it('a non-numeric reply during selection is treated as a new search', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    const result = step(session, 'Paneer Tikka', NOW_0);
    expect(result.session.state).toBe('AWAITING_SELECTION');
    expect(result.session.shownRecommendations[0]!.entry.item.name).not.toBe('Veg Biryani');
  });

  it('regression: retyping a filler-word search mid-selection returns genuinely relevant dishes', () => {
    // This is the exact real-world shape of the bug: a user sees
    // recommendations, doesn't type 1/2/3, and just types a new craving
    // instead - very normal usage, and previously let stopword-polluted
    // matching surface history-biased noise instead of real matches.
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    const result = step(session, 'i want something sweet', NOW_0);
    expect(result.session.state).toBe('AWAITING_SELECTION');
    for (const rec of result.session.shownRecommendations) {
      expect(rec.entry.item.tags).toContain('sweet');
    }
  });

  it('an invalid quantity re-prompts and keeps state', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    const result = step(session, 'a lot', NOW_0);
    expect(result.session.state).toBe('AWAITING_QUANTITY');
  });

  it('a query with no results does not advance the state', () => {
    const session = freshSession(PHONE, NOW_0);
    const result = step(session, 'xyznonexistentdish', NOW_0);
    expect(result.session.state).toBe('IDLE');
  });
});

describe('cold-start user with no saved address and no history', () => {
  it('asks for an address instead of offering a default, and still completes an order', () => {
    const phone = 'whatsapp:+19998887777';
    const ctx: Ctx = { profile: guestProfile(phone), now: NOW_0, orderIdFactory: () => 'ORD-GUEST-1' };
    let session = freshSession(phone, NOW_0);

    let result = handleMessage(session, 'Veg Biryani', ctx);
    session = result.session;
    expect(session.state).toBe('AWAITING_SELECTION');

    result = handleMessage(session, '1', ctx);
    session = result.session;
    result = handleMessage(session, '1', ctx);
    session = result.session;
    expect(session.state).toBe('IDLE');
    expect(session.cart).toHaveLength(1);

    result = handleMessage(session, 'CHECKOUT', ctx);
    session = result.session;
    expect(session.state).toBe('AWAITING_ADDRESS');
    expect(result.replies[0]).not.toContain('Deliver to:');

    result = handleMessage(session, '42 Guest Lane, Testville', ctx);
    session = result.session;
    expect(session.state).toBe('AWAITING_PROMO');
    expect(session.address).toBe('42 Guest Lane, Testville');

    result = handleMessage(session, 'SKIP', ctx);
    session = result.session;
    result = handleMessage(session, 'CONFIRM', ctx);
    session = result.session;
    expect(session.state).toBe('IDLE');
    expect(session.currentOrder?.id).toBe('ORD-GUEST-1');
  });
});

/** Runs a full search -> select -> quantity -> checkout -> address -> skip promo -> confirm flow for one dish, returning the resulting session. */
function placeOrder(now: number): Session {
  let session = freshSession(PHONE, now);
  session = step(session, 'Veg Biryani', now).session;
  session = step(session, '1', now).session;
  session = step(session, '1', now).session;
  session = step(session, 'CHECKOUT', now).session;
  session = step(session, 'YES', now).session;
  session = step(session, 'SKIP', now).session;
  return step(session, 'CONFIRM', now).session;
}

describe('multi-item cart', () => {
  it('Phase 1 acceptance scenario: add, add, change quantity, remove leaves only what should remain', () => {
    let session = freshSession(PHONE, NOW_0);

    let result = step(session, 'Add pizza.', NOW_0);
    session = result.session;
    expect(session.cart).toHaveLength(1);
    const pizzaName = session.cart[0]!.itemName;
    expect(pizzaName.toLowerCase()).toContain('pizza');

    result = step(session, 'Add coffee.', NOW_0 + 1000);
    session = result.session;
    expect(session.cart).toHaveLength(2);
    const coffeeName = session.cart[1]!.itemName;
    expect(coffeeName.toLowerCase()).toContain('coffee');

    result = step(session, 'Make the coffee two.', NOW_0 + 2000);
    session = result.session;
    expect(session.cart.find((l) => l.itemName === coffeeName)?.quantity).toBe(2);

    result = step(session, 'Remove pizza.', NOW_0 + 3000);
    session = result.session;
    expect(session.cart).toHaveLength(1);
    expect(session.cart[0]!.itemName).toBe(coffeeName);
    expect(session.cart[0]!.quantity).toBe(2);

    // Placing the order carries every remaining cart line through, and only those.
    result = step(session, 'CHECKOUT', NOW_0 + 4000);
    session = result.session;
    result = step(session, '42 Test Lane', NOW_0 + 4500);
    session = result.session;
    result = step(session, 'SKIP', NOW_0 + 5000);
    session = result.session;
    result = step(session, 'CONFIRM', NOW_0 + 5500);
    session = result.session;
    expect(session.currentOrder?.cart).toHaveLength(1);
    expect(session.currentOrder?.cart[0]?.itemName).toBe(coffeeName);
    expect(session.currentOrder?.cart[0]?.quantity).toBe(2);
  });

  it('merges adding the same dish twice into one line instead of duplicating it', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Add Veg Biryani', NOW_0).session;
    session = step(session, 'Add Veg Biryani', NOW_0 + 1000).session;
    expect(session.cart).toHaveLength(1);
    expect(session.cart[0]!.quantity).toBe(2);
  });

  it('CART shows contents and total; CLEAR CART empties it', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Add Veg Biryani', NOW_0).session;

    const cartResult = step(session, 'CART', NOW_0 + 1000);
    expect(cartResult.replies[0]).toContain('Veg Biryani');
    expect(cartResult.replies[0]).toMatch(/Subtotal/);

    const cleared = step(session, 'CLEAR CART', NOW_0 + 2000);
    expect(cleared.session.cart).toEqual([]);
    expect(cleared.replies[0]).toMatch(/cleared/i);
  });

  it('CHECKOUT on an empty cart tells the user instead of proceeding', () => {
    const session = freshSession(PHONE, NOW_0);
    const result = step(session, 'CHECKOUT', NOW_0);
    expect(result.session.state).toBe('IDLE');
    expect(result.replies[0]).toMatch(/cart is empty/i);
  });

  it('ADD/REMOVE/CHECKOUT are refused mid-selection, without disturbing the in-progress flow', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    expect(session.state).toBe('AWAITING_SELECTION');

    const result = step(session, 'Add coffee', NOW_0 + 1000);
    expect(result.session.state).toBe('AWAITING_SELECTION');
    expect(result.replies[0]).toMatch(/finish/i);
  });

  it('removing a dish not in the cart says so instead of erroring', () => {
    const session = freshSession(PHONE, NOW_0);
    const result = step(session, 'Remove pizza', NOW_0);
    expect(result.replies[0]).toMatch(/isn't in your cart/i);
  });
});

describe('REORDER', () => {
  it('says there is nothing to reorder before any order has ever been placed', () => {
    const session = freshSession(PHONE, NOW_0);
    const result = step(session, 'REORDER', NOW_0);
    expect(result.replies[0]).toMatch(/haven't placed an order/i);
  });

  it('refuses to reorder mid-flow, telling the user to cancel first', () => {
    let session = placeOrder(NOW_0);
    session = step(session, 'Paneer Tikka', NOW_0 + 1000).session; // starts a fresh, unrelated search
    expect(session.state).toBe('AWAITING_SELECTION');

    const result = step(session, 'REORDER', NOW_0 + 1000);
    expect(result.replies[0]).toMatch(/cancel/i);
    expect(result.session.state).toBe('AWAITING_SELECTION');
  });

  it('adds every item from the last order back into the cart', () => {
    const placed = placeOrder(NOW_0);
    const lastItemName = placed.currentOrder!.cart[0]!.itemName;

    const result = step(placed, 'REORDER', NOW_0 + 1000);
    expect(result.session.state).toBe('IDLE');
    expect(result.session.cart).toHaveLength(1);
    expect(result.session.cart[0]!.itemName).toBe(lastItemName);
    expect(result.replies[0]).toMatch(/added 1 item/i);

    // and checkout from here works exactly as normal
    const checkoutResult = step(result.session, 'CHECKOUT', NOW_0 + 2000);
    expect(checkoutResult.session.state).toBe('AWAITING_ADDRESS');
  });
});

describe('CANCEL after CONFIRM', () => {
  it('cancels the just-placed order while it is still only CONFIRMED', () => {
    const placed = placeOrder(NOW_0);
    const orderId = placed.currentOrder!.id;

    const result = step(placed, 'CANCEL', NOW_0 + 1000); // 1s later, well inside the CONFIRMED window
    expect(result.session.currentOrder).toBeNull();
    expect(result.replies[0]).toContain(orderId);

    // and there is genuinely nothing left to cancel afterward
    const again = step(result.session, 'CANCEL', NOW_0 + 2000);
    expect(again.replies[0]).toMatch(/not in the middle/i);
  });

  it('refuses to cancel once the kitchen has started (past the CONFIRMED stage)', () => {
    const placed = placeOrder(NOW_0);
    const orderId = placed.currentOrder!.id;

    const result = step(placed, 'CANCEL', NOW_0 + 20_000); // past the 15s CONFIRMED window
    expect(result.session.currentOrder?.id).toBe(orderId);
    expect(result.replies[0]).toMatch(/too late/i);
  });
});

describe('post-delivery rating', () => {
  it('prompts for a rating once STATUS reveals DELIVERED, and only once', () => {
    const placed = placeOrder(NOW_0);

    const delivered = step(placed, 'STATUS', NOW_0 + 91_000);
    expect(delivered.replies.join('\n')).toMatch(/how was your order/i);
    expect(delivered.session.pendingRatingOrderId).toBe(placed.currentOrder!.id);
    expect(delivered.quickReplies?.map((q) => q.value)).toEqual(['1', '2', '3', '4', '5', 'SKIP']);

    // asking again does not re-prompt
    const again = step(delivered.session, 'STATUS', NOW_0 + 92_000);
    expect(again.replies.join('\n')).not.toMatch(/how was your order/i);
  });

  it('records a numeric reply as one rating entry per cart line and stops prompting', () => {
    const placed = placeOrder(NOW_0);
    const delivered = step(placed, 'STATUS', NOW_0 + 91_000).session;

    const rated = step(delivered, '5', NOW_0 + 92_000);
    expect(rated.session.pendingRatingOrderId).toBeNull();
    expect(rated.replies[0]).toMatch(/5-star/i);
    expect(rated.ratingsToRecord).toHaveLength(1);
    expect(rated.ratingsToRecord![0]).toMatchObject({
      restaurantId: placed.currentOrder!.cart[0]!.restaurantId,
      itemId: placed.currentOrder!.cart[0]!.itemId,
      rating: 5,
    });
  });

  it('SKIP dismisses the prompt without recording anything', () => {
    const placed = placeOrder(NOW_0);
    const delivered = step(placed, 'STATUS', NOW_0 + 91_000).session;

    const skipped = step(delivered, 'SKIP', NOW_0 + 92_000);
    expect(skipped.session.pendingRatingOrderId).toBeNull();
    expect(skipped.ratingsToRecord).toBeUndefined();
  });

  it('mentions the delivery partner once the order is out for delivery', () => {
    const placed = placeOrder(NOW_0);
    const result = step(placed, 'STATUS', NOW_0 + 50_000); // past the 45s OUT_FOR_DELIVERY mark
    expect(result.replies[0]).toMatch(/delivery partner/i);
  });
});
