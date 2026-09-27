import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config, isDbConfigured } from '../config.js';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db | null = null;

/**
 * Lazily opens the Postgres connection pool on first use and reuses it for
 * the life of the process - Vercel keeps a warm serverless instance alive
 * across requests when it can, so this avoids reconnecting on every call
 * without needing a global outside this module.
 */
export function getDb(): Db | null {
  if (!isDbConfigured()) return null;
  if (!db) {
    const client = postgres(config.database.url, { max: 5 });
    db = drizzle(client, { schema });
  }
  return db;
}
