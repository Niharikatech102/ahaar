import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DATA_DIR } from '../config.js';
import { createLogger } from '../logger.js';
import { getDb } from '../db/client.js';
import { users as usersTable } from '../db/schema.js';
import type { PastOrder, UserProfile } from './types.js';

/**
 * Normalizes a raw phone number typed into the "add customer" form into the
 * `whatsapp:+<countrycode><number>` shape used as the identity key
 * throughout the app. A number with no country code is assumed to be
 * Indian (+91), matching every seeded address in this demo.
 */
export function normalizePhone(raw: string): string {
  const digitsAndPlus = raw.trim().replace(/[^\d+]/g, '');
  const withCountryCode = digitsAndPlus.startsWith('+') ? digitsAndPlus : `+91${digitsAndPlus}`;
  return `whatsapp:${withCountryCode}`;
}

/** True if a normalized phone number would look like a real phone number, not junk input. */
export function isPlausiblePhone(normalized: string): boolean {
  return /^whatsapp:\+\d{8,15}$/.test(normalized);
}

const log = createLogger('users');

function loadUsers(): UserProfile[] {
  const raw = readFileSync(path.join(DATA_DIR, 'users.json'), 'utf-8');
  return JSON.parse(raw) as UserProfile[];
}

// Local-file fallback (used only when no DATABASE_URL is set). Once a DB is
// configured, every read/write below goes straight to Postgres instead.
const seededUsers: UserProfile[] = loadUsers();

const ADDED_USERS_FILE = path.join(DATA_DIR, 'added_users.json');

function loadAddedUsers(): UserProfile[] {
  try {
    if (!existsSync(ADDED_USERS_FILE)) return [];
    return JSON.parse(readFileSync(ADDED_USERS_FILE, 'utf-8')) as UserProfile[];
  } catch (err) {
    log.error('failed to load added_users.json, starting with none', err);
    return [];
  }
}

const addedUsers: UserProfile[] = loadAddedUsers();

function persistAddedUsers(): void {
  try {
    writeFileSync(ADDED_USERS_FILE, JSON.stringify(addedUsers, null, 2), 'utf-8');
  } catch (err) {
    log.error('failed to persist added_users.json', err);
  }
}

function generateGuestPhone(): string {
  const n = Math.floor(1_000_000 + Math.random() * 8_999_999);
  return `whatsapp:+1999${n}`;
}

function rowToProfile(row: typeof usersTable.$inferSelect): UserProfile {
  return { phone: row.phone, name: row.name, addresses: row.addresses, orderHistory: row.orderHistory };
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(usersTable);
    return rows.map(rowToProfile);
  }
  return [...seededUsers, ...addedUsers];
}

export async function getUserByPhone(phone: string): Promise<UserProfile | undefined> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    return rows[0] ? rowToProfile(rows[0]) : undefined;
  }
  return seededUsers.find((u) => u.phone === phone) ?? addedUsers.find((u) => u.phone === phone);
}

export async function isPhoneTaken(phone: string): Promise<boolean> {
  return (await getUserByPhone(phone)) !== undefined;
}

/** A phone number not already used by any existing customer. */
async function uniqueGuestPhone(): Promise<string> {
  let phone = generateGuestPhone();
  while (await isPhoneTaken(phone)) {
    phone = generateGuestPhone();
  }
  return phone;
}

/**
 * Registers a new customer from the simulator's "Add new customer" form -
 * no order history yet (same starting point as any cold-start guest), but
 * unlike a guest this one is remembered: it shows up in the contact list on
 * every future load, including after a server restart. Phone and address
 * are optional so a quick test customer can still be added with just a
 * name; the router validates a provided phone before calling this.
 */
export async function addUser(name: string, phone?: string, addressLine?: string): Promise<UserProfile> {
  const profile: UserProfile = {
    phone: phone ?? (await uniqueGuestPhone()),
    name,
    addresses: addressLine ? [{ id: 'a1', label: 'Home', line: addressLine, isDefault: true }] : [],
    orderHistory: [],
  };

  const db = getDb();
  if (db) {
    await db.insert(usersTable).values({
      phone: profile.phone,
      name: profile.name,
      addresses: profile.addresses,
      orderHistory: profile.orderHistory,
    });
    return profile;
  }

  addedUsers.push(profile);
  persistAddedUsers();
  return profile;
}

/**
 * Appends a freshly-rated order to a customer's history, feeding straight
 * into the recommender's history-affinity signal for future searches. A
 * no-op for guests (no profile row exists to attach the rating to).
 */
export async function recordOrderRating(phone: string, pastOrder: PastOrder): Promise<void> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    const existing = rows[0];
    if (!existing) return;
    await db
      .update(usersTable)
      .set({ orderHistory: [pastOrder, ...existing.orderHistory] })
      .where(eq(usersTable.phone, phone));
    return;
  }

  const target = seededUsers.find((u) => u.phone === phone) ?? addedUsers.find((u) => u.phone === phone);
  if (target) target.orderHistory = [pastOrder, ...target.orderHistory];
}

/** Cold-start profile for a phone number we have no history for - no saved address, empty history. */
export function guestProfile(phone: string): UserProfile {
  return { phone, name: 'Guest', addresses: [], orderHistory: [] };
}

export async function getProfileOrGuest(phone: string): Promise<UserProfile> {
  return (await getUserByPhone(phone)) ?? guestProfile(phone);
}
