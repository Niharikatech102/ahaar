import { sql } from 'drizzle-orm';
import { getDb } from './client.js';
import { menuItems, restaurants } from './schema.js';

/**
 * One-time catalog expansion: pulls real dish names/images from TheMealDB
 * (a free, keyless recipe API) and adds them as extra restaurants/items
 * alongside the existing hand-written catalog - it does not touch or remove
 * anything already seeded by seed.ts. Run with: npm run db:seed:mealdb
 *
 * TheMealDB has no price, rating, ETA, or veg/non-veg field (it's a recipe
 * site, not a delivery platform), so those are synthesized deterministically
 * from each dish's id - re-running this script always produces the same
 * values instead of the catalog drifting on every re-seed.
 */
const API_BASE = 'https://www.themealdb.com/api/json/v1/1';

// Confirmed by direct query against the live API (TheMealDB's own
// list.php?a=list endpoint returns every country in the world, not just the
// ones that actually have recipes - most return zero results and "Indian"
// dishes are filed under the country name "India", not "Indian").
const AREAS = [
  'Algerian', 'Argentina', 'Australian', 'British', 'Canadian', 'Chinese',
  'Croatian', 'Egyptian', 'Filipino', 'France', 'Greek', 'India', 'Irish',
  'Italian', 'Jamaican', 'Japanese', 'Kenyan', 'Malaysian', 'Mexican',
  'Moroccan', 'Netherlands', 'Norway', 'Polish', 'Portuguese', 'Russian',
  'Saudi Arabian', 'Slovakia', 'Spanish', 'Syrian', 'Thai', 'Tunisian',
  'Turkish', 'Ukrainian', 'United States', 'Uruguayan', 'Venezuela', 'Vietnamese',
];

interface MealDbMeal {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchAreaMeals(area: string): Promise<MealDbMeal[]> {
  const data = await fetchJson<{ meals: MealDbMeal[] | null }>(
    `${API_BASE}/filter.php?a=${encodeURIComponent(area)}`,
  );
  return data.meals ?? [];
}

async function fetchVegMealIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const category of ['Vegetarian', 'Vegan']) {
    const data = await fetchJson<{ meals: MealDbMeal[] | null }>(
      `${API_BASE}/filter.php?c=${category}`,
    );
    for (const meal of data.meals ?? []) ids.add(meal.idMeal);
  }
  return ids;
}

/** Deterministic pseudo-random in [0, 1), seeded by a string - same input always gives the same output. */
function hashToUnit(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

function slugify(area: string): string {
  return area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function seedMealDb(): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('DATABASE_URL is not set - add it to .env before seeding');

  console.log('fetching vegetarian/vegan meal ids...');
  const vegIds = await fetchVegMealIds();

  let totalMeals = 0;
  for (const area of AREAS) {
    const meals = await fetchAreaMeals(area);
    if (meals.length === 0) {
      console.log(`${area}: 0 meals, skipping`);
      continue;
    }

    const restaurantId = `md-${slugify(area)}`;
    const prices = meals.map((m) => 120 + Math.round(hashToUnit(`${m.idMeal}-price`) * 33) * 10);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceLevel = avgPrice < 200 ? 1 : avgPrice < 320 ? 2 : 3;
    const rating = Math.round((4.0 + hashToUnit(`${restaurantId}-rating`) * 0.9) * 10) / 10;
    const etaMinutes = 20 + Math.round(hashToUnit(`${restaurantId}-eta`) * 25);

    await db
      .insert(restaurants)
      .values({
        id: restaurantId,
        name: `${area} Kitchen`,
        cuisines: [area.toLowerCase()],
        rating,
        etaMinutes,
        priceLevel,
        available: true,
      })
      .onConflictDoUpdate({
        target: restaurants.id,
        set: {
          name: sql`excluded.name`,
          cuisines: sql`excluded.cuisines`,
          rating: sql`excluded.rating`,
          etaMinutes: sql`excluded.eta_minutes`,
          priceLevel: sql`excluded.price_level`,
          available: sql`excluded.available`,
        },
      });

    for (const meal of meals) {
      const itemId = `md-${meal.idMeal}`;
      const price = 120 + Math.round(hashToUnit(`${meal.idMeal}-price`) * 33) * 10;
      await db
        .insert(menuItems)
        .values({
          id: itemId,
          restaurantId,
          name: meal.strMeal,
          veg: vegIds.has(meal.idMeal),
          price,
          tags: [area.toLowerCase()],
          image: meal.strMealThumb || null,
        })
        .onConflictDoUpdate({
          target: menuItems.id,
          set: {
            restaurantId: sql`excluded.restaurant_id`,
            name: sql`excluded.name`,
            veg: sql`excluded.veg`,
            price: sql`excluded.price`,
            tags: sql`excluded.tags`,
            image: sql`excluded.image`,
          },
        });
    }

    totalMeals += meals.length;
    console.log(`${area}: seeded ${meals.length} dishes`);
  }

  console.log(`done - ${AREAS.length} cuisines, ${totalMeals} dishes from TheMealDB`);
  process.exit(0);
}

seedMealDb().catch((err) => {
  console.error('seedMealDb failed', err);
  process.exit(1);
});
