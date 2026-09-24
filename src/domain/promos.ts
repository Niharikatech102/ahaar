import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import type { Promo } from './types.js';

function loadPromos(): Promo[] {
  const raw = readFileSync(path.join(DATA_DIR, 'promos.json'), 'utf-8');
  return JSON.parse(raw) as Promo[];
}

const promos: Promo[] = loadPromos();

export function getAllPromos(): Promo[] {
  return promos;
}

export function getPromoByCode(code: string): Promo | undefined {
  return promos.find((p) => p.code.toUpperCase() === code.trim().toUpperCase());
}

export interface OrderContext {
  subtotal: number;
  restaurantId: string;
  cuisines: string[];
  isFirstOrder: boolean;
  /** How many times this user has already redeemed this exact promo code. */
  timesUsedByUser: number;
}

export interface PromoEvalResult {
  eligible: boolean;
  reason?: string;
  discount: number;
}

/**
 * Checks whether a promo applies to this order and computes the discount if
 * so. Every rejection carries a human-readable reason, since that reason is
 * what gets sent back to the user over chat.
 */
export function evaluatePromo(promo: Promo, order: OrderContext): PromoEvalResult {
  if (promo.expired) {
    return { eligible: false, reason: 'this code has expired', discount: 0 };
  }
  if (promo.firstOrderOnly && !order.isFirstOrder) {
    return { eligible: false, reason: 'this code is valid on your first order only', discount: 0 };
  }
  if (order.timesUsedByUser >= promo.usageLimitPerUser) {
    return { eligible: false, reason: "you've already used this code the maximum number of times", discount: 0 };
  }
  if (order.subtotal < promo.minOrderValue) {
    return {
      eligible: false,
      reason: `minimum order value for this code is \u20b9${promo.minOrderValue}`,
      discount: 0,
    };
  }
  if (promo.restaurantScope && promo.restaurantScope !== order.restaurantId) {
    return { eligible: false, reason: 'this code is not valid at this restaurant', discount: 0 };
  }
  if (promo.cuisineScope && !order.cuisines.includes(promo.cuisineScope)) {
    return { eligible: false, reason: `this code is only valid on ${promo.cuisineScope} orders`, discount: 0 };
  }

  const rawDiscount = promo.type === 'percent' ? (order.subtotal * promo.value) / 100 : promo.value;
  const discount = Math.min(rawDiscount, promo.maxDiscount, order.subtotal);
  return { eligible: true, discount: Math.round(discount) };
}

/** Every promo the order is currently eligible for, largest discount first. */
export function applicablePromos(
  order: OrderContext,
  usageByCode: Record<string, number> = {},
): { promo: Promo; result: PromoEvalResult }[] {
  const eligible: { promo: Promo; result: PromoEvalResult }[] = [];

  for (const promo of promos) {
    const result = evaluatePromo(promo, { ...order, timesUsedByUser: usageByCode[promo.code] ?? 0 });
    if (result.eligible) eligible.push({ promo, result });
  }

  eligible.sort((a, b) => b.result.discount - a.result.discount);
  return eligible;
}

/** The single promo that saves the most money, or null if none apply. */
export function bestApplicablePromo(
  order: OrderContext,
  usageByCode: Record<string, number> = {},
): { promo: Promo; result: PromoEvalResult } | null {
  return applicablePromos(order, usageByCode)[0] ?? null;
}
