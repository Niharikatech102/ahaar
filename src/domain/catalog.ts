import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, isDbConfigured } from '../config.js';
import { createLogger } from '../logger.js';
import { getDb } from '../db/client.js';
import { menuItems as menuItemsTable, restaurants as restaurantsTable } from '../db/schema.js';
import type { CatalogEntry, MenuItem, Restaurant } from './types.js';

const log = createLogger('catalog');
const MIN_RATING = 4.0;

function loadRestaurantsFromJson(): Restaurant[] {
  const raw = readFileSync(path.join(DATA_DIR, 'restaurants.json'), 'utf-8');
  return JSON.parse(raw) as Restaurant[];
}

async function loadRestaurantsFromDb(): Promise<Restaurant[] | null> {
  const db = getDb();
  if (!db) return null;
  const [restaurantRows, itemRows] = await Promise.all([
    db.select().from(restaurantsTable),
    db.select().from(menuItemsTable),
  ]);
  if (restaurantRows.length === 0) return null;

  const itemsByRestaurant = new Map<string, MenuItem[]>();
  for (const row of itemRows) {
    const item: MenuItem = { id: row.id, name: row.name, veg: row.veg, price: row.price, tags: row.tags };
    if (row.image) item.image = row.image;
    const list = itemsByRestaurant.get(row.restaurantId) ?? [];
    list.push(item);
    itemsByRestaurant.set(row.restaurantId, list);
  }

  return restaurantRows.map((r) => ({
    id: r.id,
    name: r.name,
    cuisines: r.cuisines,
    rating: r.rating,
    etaMinutes: r.etaMinutes,
    priceLevel: r.priceLevel as 1 | 2 | 3,
    available: r.available,
    items: itemsByRestaurant.get(r.id) ?? [],
  }));
}

// Loaded once per process. Falls back to the local JSON fixture when no
// DATABASE_URL is set, or if the DB read fails at startup (e.g. a cold Neon
// instance not yet reachable) - a working catalog beats a crashed server.
let restaurants: Restaurant[] = loadRestaurantsFromJson();

if (isDbConfigured()) {
  try {
    const fromDb = await loadRestaurantsFromDb();
    if (fromDb) {
      restaurants = fromDb;
      log.info(`loaded ${fromDb.length} restaurants from Postgres`);
    } else {
      log.warn('DATABASE_URL is set but the restaurants table is empty - run `npm run db:seed`; using local JSON for now');
    }
  } catch (err) {
    log.error('failed to load catalog from Postgres, falling back to local JSON', err);
  }
}

export function getAllRestaurants(): Restaurant[] {
  return restaurants;
}

export function getRestaurantById(id: string): Restaurant | undefined {
  return restaurants.find((r) => r.id === id);
}

export function getItemById(restaurantId: string, itemId: string): MenuItem | undefined {
  return getRestaurantById(restaurantId)?.items.find((i) => i.id === itemId);
}

// Words too short or too generic to carry search meaning - without this, a
// query like "I want something sweet" lets the token "i" fuzzy-match almost
// any dish (e.g. "b[i]ryani") via the substring check in matchScore, drowning
// out the one token ("sweet") that's actually meaningful.
const STOPWORDS = new Set([
  'i', 'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'is', 'im', 'me', 'my',
  'some', 'something', 'anything', 'want', 'wanna', 'would', 'like', 'please', 'need',
  'looking', 'craving', 'get', 'order', 'give', 'have', 'has', 'had', 'with', 'and',
  'or', 'not', 'too', 'very', 'bit', 'maybe', 'just', 'that', 'this', 'can', 'could',
  'you', 'your', 'it', 'be', 'do',
]);

/** Exported so recommender.ts reuses the exact same tokenization instead of duplicating it. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/**
 * Fraction of query tokens present in the item's searchable text (name + tags
 * + parent cuisines). 1.0 means every query token matched something.
 */
export function matchScore(entry: CatalogEntry, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const haystack = [
    ...tokenize(entry.item.name),
    ...entry.item.tags.map((t) => t.toLowerCase()),
    ...entry.restaurant.cuisines.map((c) => c.toLowerCase()),
  ];
  const hits = queryTokens.filter((qt) => haystack.some((h) => h.includes(qt) || qt.includes(h)));
  return hits.length / queryTokens.length;
}

export interface SearchOptions {
  vegOnly?: boolean;
  maxPrice?: number;
  minRating?: number;
}

/**
 * Full catalog search: 4-star-and-above hard filter (the assignment's
 * requirement), availability, optional diet/budget constraints, and a
 * text-match score against the free-text query. Returns entries sorted by
 * match score only - `recommender.ts` re-ranks with history and other
 * signals on top of this.
 */
export function searchCatalog(query: string, options: SearchOptions = {}): CatalogEntry[] {
  const minRating = options.minRating ?? MIN_RATING;
  const queryTokens = tokenize(query);

  const entries: CatalogEntry[] = [];
  for (const restaurant of restaurants) {
    if (!restaurant.available) continue;
    if (restaurant.rating < minRating) continue;

    for (const item of restaurant.items) {
      if (options.vegOnly && !item.veg) continue;
      if (options.maxPrice !== undefined && item.price > options.maxPrice) continue;
      entries.push({ restaurant, item });
    }
  }

  const scored = entries
    .map((entry) => ({ entry, score: matchScore(entry, queryTokens) }))
    .filter(({ score }) => queryTokens.length === 0 || score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ entry }) => entry);
}
