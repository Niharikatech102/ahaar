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

describe('full ordering flow: search -> select -> quantity -> address -> promo -> confirm', () => {
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

    // 3. Quantity
    result = step(session, '2', NOW_0 + 2000);
    session = result.session;
    expect(session.state).toBe('AWAITING_ADDRESS');
    expect(session.quantity).toBe(2);
    expect(result.replies[0]).toContain('12 MG Road');

    // 4. Confirm default address
    result = step(session, 'YES', NOW_0 + 3000);
    session = result.session;
    expect(session.state).toBe('AWAITING_PROMO');
    expect(session.address).toBe('12 MG Road, Bengaluru 560001');

    // 5. Skip promo
    result = step(session, 'SKIP', NOW_0 + 4000);
    session = result.session;
    expect(session.state).toBe('AWAITING_CONFIRM');
    expect(result.replies[0]).toContain('Total: ₹');
    expect(session.appliedPromoCode).toBeNull();

    // 6. Confirm order
    result = step(session, 'CONFIRM', NOW_0 + 5000);
    session = result.session;
    expect(session.state).toBe('IDLE');
    expect(session.currentOrder).not.toBeNull();
    expect(session.currentOrder?.id).toBe('ORD-TEST-0001');
    expect(result.replies[0]).toContain('Order placed');

    // 7. Immediately after placing, status is CONFIRMED
    result = step(session, 'STATUS', NOW_0 + 5500);
    session = result.session;
    expect(result.replies[0]).toContain('confirmed');

    // 8. Later, status progresses toward delivery
    const laterStatus = statusAt(session.currentOrder!.placedAt, NOW_0 + 5000 + 50_000);
    expect(laterStatus).toBe('OUT_FOR_DELIVERY');
  });

  it('applies a promo code end to end and reflects the discount in the bill', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    session = step(session, '3', NOW_0).session; // qty 3, pushes subtotal well above promo thresholds
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
    session = step(session, 'YES', NOW_0).session;

    const result = step(session, 'NOTAREALCODE', NOW_0);
    expect(result.session.state).toBe('AWAITING_PROMO');
    expect(result.replies[0]).toContain("isn't a code");
  });
});

describe('global commands work in every state', () => {
  it('CANCEL resets an in-progress order back to IDLE', () => {
    let session = freshSession(PHONE, NOW_0);
    session = step(session, 'Veg Biryani', NOW_0).session;
    session = step(session, '1', NOW_0).session;
    expect(session.state).toBe('AWAITING_QUANTITY');

    const result = step(session, 'CANCEL', NOW_0);
    expect(result.session.state).toBe('IDLE');
    expect(result.session.selected).toBeNull();
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

/** Runs a full search -> select -> quantity -> address -> skip promo -> confirm flow, returning the resulting session. */
function placeOrder(now: number): Session {
  let session = freshSession(PHONE, now);
  session = step(session, 'Veg Biryani', now).session;
  session = step(session, '1', now).session;
  session = step(session, '1', now).session;
  session = step(session, 'YES', now).session;
  session = step(session, 'SKIP', now).session;
  return step(session, 'CONFIRM', now).session;
}

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

  it('re-selects the same dish and jumps straight to the quantity prompt', () => {
    const placed = placeOrder(NOW_0);
    const lastItemName = placed.currentOrder!.cart.itemName;

    const result = step(placed, 'REORDER', NOW_0 + 1000);
    expect(result.session.state).toBe('AWAITING_QUANTITY');
    expect(result.session.selected?.item.name).toBe(lastItemName);
    expect(result.replies[0]).toContain(lastItemName);

    // and the rest of the flow works exactly as normal from here
    const qtyResult = step(result.session, '2', NOW_0 + 2000);
    expect(qtyResult.session.state).toBe('AWAITING_ADDRESS');
    expect(qtyResult.session.quantity).toBe(2);
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

    // asking again does not re-prompt
    const again = step(delivered.session, 'STATUS', NOW_0 + 92_000);
    expect(again.replies.join('\n')).not.toMatch(/how was your order/i);
  });

  it('records a numeric reply as the rating and stops prompting', () => {
    const placed = placeOrder(NOW_0);
    const delivered = step(placed, 'STATUS', NOW_0 + 91_000).session;

    const rated = step(delivered, '5', NOW_0 + 92_000);
    expect(rated.session.pendingRatingOrderId).toBeNull();
    expect(rated.replies[0]).toMatch(/5-star/i);
    expect(rated.ratingToRecord).toMatchObject({
      restaurantId: placed.currentOrder!.cart.restaurantId,
      itemId: placed.currentOrder!.cart.itemId,
      rating: 5,
    });
  });

  it('SKIP dismisses the prompt without recording anything', () => {
    const placed = placeOrder(NOW_0);
    const delivered = step(placed, 'STATUS', NOW_0 + 91_000).session;

    const skipped = step(delivered, 'SKIP', NOW_0 + 92_000);
    expect(skipped.session.pendingRatingOrderId).toBeNull();
    expect(skipped.ratingToRecord).toBeUndefined();
  });

  it('mentions the delivery partner once the order is out for delivery', () => {
    const placed = placeOrder(NOW_0);
    const result = step(placed, 'STATUS', NOW_0 + 50_000); // past the 45s OUT_FOR_DELIVERY mark
    expect(result.replies[0]).toMatch(/delivery partner/i);
  });
});
