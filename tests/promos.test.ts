import { describe, expect, it } from 'vitest';
import { bestApplicablePromo, evaluatePromo, getPromoByCode } from '../src/domain/promos.js';

describe('evaluatePromo', () => {
  it('rejects an expired code', () => {
    const promo = getPromoByCode('OLD25')!;
    const result = evaluatePromo(promo, {
      subtotal: 500,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it('rejects when order is below the minimum value', () => {
    const promo = getPromoByCode('FLAT50')!;
    const result = evaluatePromo(promo, {
      subtotal: 100,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/minimum order value/);
  });

  it('applies a flat discount correctly above the threshold', () => {
    const promo = getPromoByCode('FLAT50')!;
    const result = evaluatePromo(promo, {
      subtotal: 400,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(true);
    expect(result.discount).toBe(50);
  });

  it('caps a percent discount at maxDiscount', () => {
    const promo = getPromoByCode('BIRYANI20')!; // 20% up to Rs.80
    const result = evaluatePromo(promo, {
      subtotal: 1000, // 20% would be 200, capped at 80
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(true);
    expect(result.discount).toBe(80);
  });

  it('rejects a cuisine-scoped code on the wrong cuisine', () => {
    const promo = getPromoByCode('BIRYANI20')!;
    const result = evaluatePromo(promo, {
      subtotal: 500,
      restaurantId: 'r07',
      cuisines: ['italian'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/biryani/);
  });

  it('rejects a restaurant-scoped code at a different restaurant', () => {
    const promo = getPromoByCode('SWEET10')!; // scoped to r10
    const result = evaluatePromo(promo, {
      subtotal: 500,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(false);
  });

  it('rejects a first-order-only code for a repeat customer', () => {
    const promo = getPromoByCode('WELCOME50')!;
    const result = evaluatePromo(promo, {
      subtotal: 300,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/first order/);
  });

  it('rejects a code once its per-user usage limit is reached', () => {
    const promo = getPromoByCode('SWEET10')!; // limit 2
    const result = evaluatePromo(promo, {
      subtotal: 200,
      restaurantId: 'r10',
      cuisines: ['desserts'],
      isFirstOrder: false,
      timesUsedByUser: 2,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already used/);
  });

  it('never discounts more than the subtotal', () => {
    const promo = getPromoByCode('WELCOME50')!; // 50% up to Rs.100
    const result = evaluatePromo(promo, {
      subtotal: 160,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: true,
      timesUsedByUser: 0,
    });
    expect(result.eligible).toBe(true);
    expect(result.discount).toBeLessThanOrEqual(160);
  });
});

describe('bestApplicablePromo', () => {
  it('picks the single largest eligible discount among several applicable codes', () => {
    const best = bestApplicablePromo({
      subtotal: 600,
      restaurantId: 'r01',
      cuisines: ['biryani'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(best).not.toBeNull();
    // FLAT50=50, BIRYANI20 capped at 80, MEGA100=100 -> MEGA100 should win.
    expect(best!.promo.code).toBe('MEGA100');
    expect(best!.result.discount).toBe(100);
  });

  it('returns null when no promo is eligible', () => {
    const best = bestApplicablePromo({
      subtotal: 50,
      restaurantId: 'r09',
      cuisines: ['fast food'],
      isFirstOrder: false,
      timesUsedByUser: 0,
    });
    expect(best).toBeNull();
  });
});
