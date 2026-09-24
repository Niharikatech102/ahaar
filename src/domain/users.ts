import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import type { UserProfile } from './types.js';

function loadUsers(): UserProfile[] {
  const raw = readFileSync(path.join(DATA_DIR, 'users.json'), 'utf-8');
  return JSON.parse(raw) as UserProfile[];
}

const users: UserProfile[] = loadUsers();

export function getAllUsers(): UserProfile[] {
  return users;
}

export function getUserByPhone(phone: string): UserProfile | undefined {
  return users.find((u) => u.phone === phone);
}

/** Cold-start profile for a phone number we have no history for - no saved address, empty history. */
export function guestProfile(phone: string): UserProfile {
  return { phone, name: 'Guest', addresses: [], orderHistory: [] };
}

export function getProfileOrGuest(phone: string): UserProfile {
  return getUserByPhone(phone) ?? guestProfile(phone);
}
