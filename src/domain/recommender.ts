import { matchScore, searchCatalog, tokenize } from './catalog.js';
import type { CatalogEntry, PastOrder, Recommendation, UserPreferences } from './types.js';

const WEIGHTS = {
  rating: 0.25,
  history: 0.25,
  match: 0.2,
  eta: 0.1,
  priceFit: 0.1,
  preference: 0.1,
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
  /** Cuisines the user has ordered before that this restaurant also serves - a scoring signal, not yet verified against this specific item. */
  matchedCuisines: Set<string>;
}

function historyAffinity(entry: CatalogEntry, history: PastOrder[]): HistorySignal {
  if (history.length === 0) {
    return { score: 0, sameRestaurantCount: 0, sameDishOrdered: false, matchedCuisines: new Set() };
  }

  let restaurantWeight = 0;
  let cuisineWeight = 0;
  let sameRestaurantCount = 0;
  const matchedCuisines = new Set<string>();
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
      matchedCuisines.add(order.cuisine);
    }
  }

  const dishBonus = sameDishOrdered ? 0.25 : 0;
  const score = clamp01(restaurantWeight + cuisineWeight + dishBonus);
  return { score, sameRestaurantCount, sameDishOrdered, matchedCuisines };
}

/**
 * A cuisine match is only worth mentioning in the reason text if the
 * recommended item itself carries that cuisine as a tag - otherwise the
 * restaurant merely serves that cuisine *among other things*, and naming it
 * produces a misleading reason (e.g. crediting a chai to "your usual
 * biryani orders" just because the restaurant also sells biryani).
 */
function relevantCuisineMatch(entry: CatalogEntry, matchedCuisines: Set<string>): string | null {
  const itemTags = entry.item.tags.map((t) => t.toLowerCase());
  for (const cuisine of matchedCuisines) {
    if (itemTags.includes(cuisine.toLowerCase())) return cuisine;
  }
  return null;
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

/**
 * How well an item matches the user's saved preferences (cuisine/dietary/
 * spice/budget), independent of anything they've actually ordered before.
 * 0 when no preferences are set, so profiles without any leave every
 * candidate's ranking unchanged.
 */
function preferenceMatch(entry: CatalogEntry, prefs: UserPreferences | undefined): number {
  if (!prefs) return 0;
  const itemTags = entry.item.tags.map((t) => t.toLowerCase());
  const cuisines = entry.restaurant.cuisines.map((c) => c.toLowerCase());

  let score = 0;
  if (prefs.cuisines.some((c) => cuisines.includes(c.toLowerCase()) || itemTags.includes(c.toLowerCase()))) {
    score += 0.5;
  }
  if (prefs.dietary === 'veg' && entry.item.veg) score += 0.3;
  if (prefs.dietary === 'non-veg' && !entry.item.veg) score += 0.3;
  if (prefs.dietary === 'vegan' && entry.item.veg && itemTags.includes('vegan')) score += 0.3;
  if (prefs.spiceLevel && itemTags.includes(prefs.spiceLevel)) score += 0.1;
  if (prefs.budgetMax !== null && entry.item.price <= prefs.budgetMax) score += 0.1;

  return clamp01(score);
}

function buildReason(
  entry: CatalogEntry,
  history: HistorySignal,
  queryScore: number,
  prefs: UserPreferences | undefined,
): string {
  const parts: string[] = [];

  const cuisineMatch = relevantCuisineMatch(entry, history.matchedCuisines);

  if (history.sameDishOrdered) {
    parts.push("you've ordered this exact dish before");
  } else if (history.sameRestaurantCount > 0) {
    parts.push(
      `you've ordered from ${entry.restaurant.name} ${history.sameRestaurantCount}x before`,
    );
  } else if (cuisineMatch) {
    parts.push(`matches your usual ${cuisineMatch} orders`);
  }

  if (prefs?.dietary === 'veg' && entry.item.veg) parts.push('matches your vegetarian preference');
  if (prefs?.budgetMax != null && entry.item.price <= prefs.budgetMax) parts.push('within your budget');

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
  /** The user's saved food preferences, if any - an additional scoring signal layered on top of history. */
  preferences?: UserPreferences;
  /** Item ids to leave out entirely - how "give me more" avoids repeating dishes already shown for this search. */
  excludeItemIds?: string[];
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

  const excludeIds = new Set(options.excludeItemIds ?? []);
  const candidates = searchCatalog(query, {
    vegOnly: options.vegOnly,
    maxPrice: options.maxPrice,
  }).filter((entry) => !excludeIds.has(entry.item.id));

  const scored = candidates.map((entry) => {
    const qScore = matchScore(entry, tokenize(query));
    const hist = historyAffinity(entry, history);
    const rating = normalizeRating(entry.restaurant.rating);
    const eta = normalizeEta(entry.restaurant.etaMinutes);
    const price = priceFit(entry.item.price, typicalSpend);
    const preference = preferenceMatch(entry, options.preferences);

    const score =
      WEIGHTS.rating * rating +
      WEIGHTS.history * hist.score +
      WEIGHTS.match * qScore +
      WEIGHTS.eta * eta +
      WEIGHTS.priceFit * price +
      WEIGHTS.preference * preference;

    return { entry, score, reason: buildReason(entry, hist, qScore, options.preferences) };
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

export interface UsualOrder {
  restaurantId: string;
  itemId: string;
  timesOrdered: number;
}

/**
 * The user's most-frequently-ordered dish - deliberately not just their most
 * recent one, since "my usual" means a real habit, not whatever they happened
 * to get last time. Ties broken by recency (the more recently-repeated habit
 * wins). Null if there's no history to work from.
 */
export function getUsualOrder(history: PastOrder[]): UsualOrder | null {
  if (history.length === 0) return null;

  const counts = new Map<string, { restaurantId: string; itemId: string; count: number; minDaysAgo: number }>();
  for (const order of history) {
    const key = `${order.restaurantId}::${order.itemId}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      existing.minDaysAgo = Math.min(existing.minDaysAgo, order.daysAgo);
    } else {
      counts.set(key, { restaurantId: order.restaurantId, itemId: order.itemId, count: 1, minDaysAgo: order.daysAgo });
    }
  }

  let best: { restaurantId: string; itemId: string; count: number; minDaysAgo: number } | null = null;
  for (const candidate of counts.values()) {
    if (!best || candidate.count > best.count || (candidate.count === best.count && candidate.minDaysAgo < best.minDaysAgo)) {
      best = candidate;
    }
  }

  return best && { restaurantId: best.restaurantId, itemId: best.itemId, timesOrdered: best.count };
}
