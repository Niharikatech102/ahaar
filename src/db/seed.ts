import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { DATA_DIR } from '../config.js';
import { getDb } from './client.js';
import { menuItems, restaurants, users } from './schema.js';
import type { Restaurant, UserProfile } from '../domain/types.js';

/**
 * One-time migration: pushes the existing local JSON fixtures (catalog +
 * seeded/added users) into Postgres. Safe to re-run - every insert upserts
 * on primary key, so it converges rather than duplicating.
 * Run with: npm run db:seed
 */
async function seed(): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('DATABASE_URL is not set - add it to .env before seeding');
  }

  const restaurantData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'restaurants.json'), 'utf-8'),
  ) as Restaurant[];

  for (const r of restaurantData) {
    await db
      .insert(restaurants)
      .values({
        id: r.id,
        name: r.name,
        cuisines: r.cuisines,
        rating: r.rating,
        etaMinutes: r.etaMinutes,
        priceLevel: r.priceLevel,
        available: r.available,
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

    for (const item of r.items) {
      await db
        .insert(menuItems)
        .values({
          id: item.id,
          restaurantId: r.id,
          name: item.name,
          veg: item.veg,
          price: item.price,
          tags: item.tags,
          image: item.image ?? null,
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
  }
  console.log(`seeded ${restaurantData.length} restaurants, ${restaurantData.reduce((n, r) => n + r.items.length, 0)} menu items`);

  const seedFiles = ['users.json', 'added_users.json'];
  let userCount = 0;
  for (const file of seedFiles) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const userData = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as UserProfile[];
    for (const u of userData) {
      await db
        .insert(users)
        .values({
          phone: u.phone,
          name: u.name,
          addresses: u.addresses,
          orderHistory: u.orderHistory,
        })
        .onConflictDoUpdate({
          target: users.phone,
          set: {
            name: sql`excluded.name`,
            addresses: sql`excluded.addresses`,
            orderHistory: sql`excluded.order_history`,
          },
        });
      userCount += 1;
    }
  }
  console.log(`seeded ${userCount} users`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('seed failed', err);
  process.exit(1);
});
