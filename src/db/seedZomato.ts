import { readFileSync } from 'node:fs';
import path from 'node:path';
import { like } from 'drizzle-orm';
import { getDb } from './client.js';
import { menuItems, restaurants } from './schema.js';
import { PROJECT_ROOT } from '../config.js';

/**
 * One-time catalog expansion: adds real Bangalore restaurants (name,
 * cuisines, rating, cost tier) from the Zomato Bangalore Restaurants Kaggle
 * dataset, alongside the existing hand-written catalog - does not touch or
 * remove anything already seeded outside the zom- id prefix.
 * Run with: npm run db:seed:zomato
 *
 * Every zom- row is deleted and reinserted from scratch each run rather than
 * upserted, because zomato_transform.py assigns ids by iteration order over
 * its own deduplication pass - a re-run of the transform (e.g. after a
 * mapping tweak) can shuffle which id a given restaurant gets, and an upsert
 * would leave the previous run's now-stale ids sitting in the table forever.
 *
 * The source dataset has no per-dish price, veg/non-veg flag, ETA, or photo
 * for any restaurant - see zomato_transform.py (run separately, once, to
 * produce zomato-derived.json) for exactly how each of those was estimated
 * or inferred rather than fabricated outright:
 *   - price: anchored to the restaurant's real "cost for two" figure
 *   - veg: inferred from dish-name keywords (a heuristic, not verified fact)
 *   - etaMinutes: fully synthetic, no real signal exists for this at all
 *   - image: a representative stock photo for the dish's cuisine bucket,
 *     reusing the exact photos Ahaar's own hand-curated catalog already
 *     uses for that cuisine - not a photo of this specific dish
 * Restaurant name, cuisines, rating, and cost-tier ARE real, straight from
 * the dataset. Only restaurants with a real rating >= 4.0 were included,
 * since every catalog/search/recommend path in this app already hard-filters
 * below that - anything under it would never surface regardless of import.
 */
interface ZomatoItem {
  id: string;
  name: string;
  veg: boolean;
  price: number;
  tags: string[];
  image: string;
}

interface ZomatoRestaurant {
  id: string;
  name: string;
  cuisines: string[];
  rating: number;
  etaMinutes: number;
  priceLevel: number;
  available: boolean;
  items: ZomatoItem[];
}

const BATCH_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function seedZomato(): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('DATABASE_URL is not set - add it to .env before seeding');

  const inputPath = path.join(PROJECT_ROOT, 'zomato-derived.json');
  console.log(`reading ${inputPath}...`);
  const data = JSON.parse(readFileSync(inputPath, 'utf-8')) as ZomatoRestaurant[];
  console.log(`${data.length} restaurants, ${data.reduce((n, r) => n + r.items.length, 0)} dishes to seed`);

  console.log('clearing previous zom- rows...');
  await db.delete(menuItems).where(like(menuItems.id, 'zom-%'));
  await db.delete(restaurants).where(like(restaurants.id, 'zom-%'));

  const restaurantBatches = chunk(data, BATCH_SIZE);
  for (const [i, batch] of restaurantBatches.entries()) {
    await db.insert(restaurants).values(
      batch.map((r) => ({
        id: r.id,
        name: r.name,
        cuisines: r.cuisines,
        rating: r.rating,
        etaMinutes: r.etaMinutes,
        priceLevel: r.priceLevel as 1 | 2 | 3,
        available: r.available,
      })),
    );
    console.log(`restaurants: batch ${i + 1}/${restaurantBatches.length}`);
  }

  const allItems = data.flatMap((r) => r.items.map((it) => ({ ...it, restaurantId: r.id })));
  const itemBatches = chunk(allItems, BATCH_SIZE);
  for (const [i, batch] of itemBatches.entries()) {
    await db.insert(menuItems).values(
      batch.map((it) => ({
        id: it.id,
        restaurantId: it.restaurantId,
        name: it.name,
        veg: it.veg,
        price: it.price,
        tags: it.tags,
        image: it.image,
      })),
    );
    console.log(`menu items: batch ${i + 1}/${itemBatches.length}`);
  }

  console.log(`done - ${data.length} restaurants, ${allItems.length} dishes from Zomato Bangalore Restaurants`);
  process.exit(0);
}

seedZomato().catch((err) => {
  console.error('seedZomato failed', err);
  process.exit(1);
});
