import { describe, expect, it } from 'vitest';
import { handleMessage, type Ctx } from '../src/core/stateMachine.js';
import { freshSession, type Session } from '../src/core/session.js';
import { getUserByPhone, guestProfile } from '../src/domain/users.js';
import { statusAt } from '../src/domain/delivery.js';

const PHONE = 'whatsapp:+15551230001'; // Aryan - has biryani history, one default address
const NOW_0 = 1_700_000_000_000;

function ctxAt(now: number): Ctx {
  const profile = getUserByPhone(PHONE)!;
  return { profile, now, orderIdFactory: () => 'ORD-TEST-0001' };
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
