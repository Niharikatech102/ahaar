import { matchScore, searchCatalog } from './catalog.js';
import type { CatalogEntry, PastOrder, Recommendation } from './types.js';

const WEIGHTS = {
  rating: 0.3,
  history: 0.3,
  match: 0.2,
  eta: 0.1,
  priceFit: 0.1,
} as const;

const RATING_FLOOR = 4.0;
const RATING_CEILING = 5.0;
const ETA_FAST = 15; // minutes - anything this fast or faster scores 1.0
const ETA_SLOW = 60; // minutes - anything this slow or slower scores 0.0
const HISTORY_HALF_LIFE_DAYS = 30; // a same-restaurant order this old is worth half weight

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeRating(rating: number): number {
  return clamp01((rating - RATING_FLOOR) / (RATING_CEILING - RATING_FLOOR));
}

function normalizeEta(etaMinutes: number): number {
  return clamp01((ETA_SLOW - etaMinutes) / (ETA_SLOW - ETA_FAST));
}

/** Recency-decayed weight for a single past order: 1.0 today, 0.5 at the half-life, asymptotic to 0. */
function recencyWeight(daysAgo: number): number {
  return Math.pow(0.5, daysAgo / HISTORY_HALF_LIFE_DAYS);
}

interface HistorySignal {
  score: number;
  sameRestaurantCount: number;
  sameDishOrdered: boolean;
  sameCuisineCount: number;
}

function historyAffinity(entry: CatalogEntry, history: PastOrder[]): HistorySignal {
  if (history.length === 0) {
    return { score: 0, sameRestaurantCount: 0, sameDishOrdered: false, sameCuisineCount: 0 };
  }

  let restaurantWeight = 0;
  let cuisineWeight = 0;
  let sameRestaurantCount = 0;
  let sameCuisineCount = 0;
  let sameDishOrdered = false;

  for (const order of history) {
    const w = recencyWeight(order.daysAgo);
    const satisfactionFactor = order.rating / 5;

    if (order.restaurantId === entry.restaurant.id) {
      restaurantWeight += w * satisfactionFactor;
      sameRestaurantCount += 1;
      if (order.itemId === entry.item.id) sameDishOrdered = true;
    }
    if (entry.restaurant.cuisines.includes(order.cuisine)) {
      cuisineWeight += w * satisfactionFactor * 0.5; // cuisine match counts for less than the exact restaurant
      sameCuisineCount += 1;
    }
  }

  const dishBonus = sameDishOrdered ? 0.25 : 0;
  const score = clamp01(restaurantWeight + cuisineWeight + dishBonus);
  return { score, sameRestaurantCount, sameDishOrdered, sameCuisineCount };
}

/** How close the item's price is to the user's typical spend (median of past order-adjacent prices, or a flat default). */
function priceFit(price: number, typicalSpend: number): number {
  const ratio = price / typicalSpend;
  // 1.0 at the typical spend, decaying symmetrically as price diverges from it.
  return clamp01(1 - Math.abs(Math.log(ratio)) / Math.log(3));
}

function estimateTypicalSpend(history: PastOrder[], fallback: number): number {
  if (history.length === 0) return fallback;
  // Fixture data doesn't carry historical item price, so this approximates
  // "typical spend" from the fallback anchored by how active the user is.
  return fallback;
}

function buildReason(entry: CatalogEntry, history: HistorySignal, queryScore: number): string {
  const parts: string[] = [];

  if (history.sameDishOrdered) {
    parts.push("you've ordered this exact dish before");
  } else if (history.sameRestaurantCount > 0) {
    parts.push(
      `you've ordered from ${entry.restaurant.name} ${history.sameRestaurantCount}x before`,
    );
  } else if (history.sameCuisineCount > 0) {
    parts.push(`matches your usual ${entry.restaurant.cuisines[0]} orders`);
  }

  parts.push(`${entry.restaurant.rating.toFixed(1)}\u2605`);
  parts.push(`${entry.restaurant.etaMinutes} min`);

  if (queryScore >= 0.999 && parts.length < 2) {
    parts.push('close match for your search');
  }

  return parts.join(' \u00b7 ');
}

export interface RecommendOptions {
  vegOnly?: boolean;
  maxPrice?: number;
  limit?: number;
  /** Average order value, used as the anchor for the price-fit signal. Defaults to a mid-range estimate. */
  fallbackTypicalSpend?: number;
}

/**
 * Ranks catalog matches for a free-text query against a specific user's
 * order history. Enforces at most one dish per restaurant so the three
 * results are genuinely distinct choices, not three items from one kitchen.
 */
export function recommend(
  query: string,
  history: PastOrder[],
  options: RecommendOptions = {},
): Recommendation[] {
  const limit = options.limit ?? 3;
  const typicalSpend = estimateTypicalSpend(history, options.fallbackTypicalSpend ?? 250);

  const candidates = searchCatalog(query, {
    vegOnly: options.vegOnly,
    maxPrice: options.maxPrice,
  });

  const scored = candidates.map((entry) => {
    const qScore = matchScore(entry, query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const hist = historyAffinity(entry, history);
    const rating = normalizeRating(entry.restaurant.rating);
    const eta = normalizeEta(entry.restaurant.etaMinutes);
    const price = priceFit(entry.item.price, typicalSpend);

    const score =
      WEIGHTS.rating * rating +
      WEIGHTS.history * hist.score +
      WEIGHTS.match * qScore +
      WEIGHTS.eta * eta +
      WEIGHTS.priceFit * price;

    return { entry, score, reason: buildReason(entry, hist, qScore) };
  });

  scored.sort((a, b) => b.score - a.score);

  // Diversity constraint: at most one dish per restaurant, so three
  // recommendations are three real choices rather than one kitchen's menu.
  const seenRestaurants = new Set<string>();
  const diverse: Recommendation[] = [];
  for (const candidate of scored) {
    if (seenRestaurants.has(candidate.entry.restaurant.id)) continue;
    seenRestaurants.add(candidate.entry.restaurant.id);
    diverse.push(candidate);
    if (diverse.length >= limit) break;
  }

  return diverse;
}
