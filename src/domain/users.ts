import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { createLogger } from '../logger.js';
import type { UserProfile } from './types.js';

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

const seededUsers: UserProfile[] = loadUsers();

// Customers added through the simulator's "Add new customer" flow. Kept in
// their own file (not users.json, which is seed data checked into git) and
// persisted to disk so a newly added customer survives a server restart,
// same as a placed order does via SessionStore.
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

/** A phone number not already used by a seeded or previously-added customer. */
function uniqueGuestPhone(): string {
  let phone = generateGuestPhone();
  while (seededUsers.some((u) => u.phone === phone) || addedUsers.some((u) => u.phone === phone)) {
    phone = generateGuestPhone();
  }
  return phone;
}

export function getAllUsers(): UserProfile[] {
  return [...seededUsers, ...addedUsers];
}

export function getUserByPhone(phone: string): UserProfile | undefined {
  return seededUsers.find((u) => u.phone === phone) ?? addedUsers.find((u) => u.phone === phone);
}

export function isPhoneTaken(phone: string): boolean {
  return getUserByPhone(phone) !== undefined;
}

/**
 * Registers a new customer from the simulator's "Add new customer" form -
 * no order history yet (same starting point as any cold-start guest), but
 * unlike a guest this one is remembered: it shows up in the contact list on
 * every future load, including after a server restart. Phone and address
 * are optional so a quick test customer can still be added with just a
 * name; the router validates a provided phone before calling this.
 */
export function addUser(name: string, phone?: string, addressLine?: string): UserProfile {
  const profile: UserProfile = {
    phone: phone ?? uniqueGuestPhone(),
    name,
    addresses: addressLine ? [{ id: 'a1', label: 'Home', line: addressLine, isDefault: true }] : [],
    orderHistory: [],
  };
  addedUsers.push(profile);
  persistAddedUsers();
  return profile;
}

/** Cold-start profile for a phone number we have no history for - no saved address, empty history. */
export function guestProfile(phone: string): UserProfile {
  return { phone, name: 'Guest', addresses: [], orderHistory: [] };
}

export function getProfileOrGuest(phone: string): UserProfile {
  return getUserByPhone(phone) ?? guestProfile(phone);
}
