import { describe, expect, it } from 'vitest';
import {
  addUser,
  getAllUsers,
  getUserByPhone,
  isPhoneTaken,
  isPlausiblePhone,
  normalizePhone,
  updateUserPreferences,
} from '../src/domain/users.js';

describe('addUser', () => {
  it('registers a new customer with no history and no saved address', async () => {
    const profile = await addUser('Priya');
    expect(profile.name).toBe('Priya');
    expect(profile.phone).toMatch(/^whatsapp:\+1999\d+$/);
    expect(profile.orderHistory).toEqual([]);
    expect(profile.addresses).toEqual([]);
  });

  it('is immediately findable by phone and appears in the full user list', async () => {
    const profile = await addUser('Karan');
    expect((await getUserByPhone(profile.phone))?.name).toBe('Karan');
    expect((await getAllUsers()).some((u) => u.phone === profile.phone)).toBe(true);
  });

  it('gives two different customers distinct phone numbers', async () => {
    const a = await addUser('Customer A');
    const b = await addUser('Customer B');
    expect(a.phone).not.toBe(b.phone);
  });

  it('does not affect the seeded demo users', async () => {
    const before = (await getAllUsers()).filter((u) => u.phone === 'whatsapp:+15551230001');
    await addUser('Someone New');
    const after = (await getAllUsers()).filter((u) => u.phone === 'whatsapp:+15551230001');
    expect(after).toEqual(before);
  });

  it('saves a provided phone and address as the customer default address', async () => {
    const profile = await addUser('Full Details', 'whatsapp:+919876543210', '42 Custom Lane, Pune');
    expect(profile.phone).toBe('whatsapp:+919876543210');
    expect(profile.addresses).toEqual([
      { id: 'a1', label: 'Home', line: '42 Custom Lane, Pune', isDefault: true },
    ]);
  });

  it('starts every new customer with empty (not missing) preferences', async () => {
    const profile = await addUser('Preference Test Customer');
    expect(profile.preferences).toEqual({ cuisines: [], dietary: null, spiceLevel: null, budgetMax: null });
  });
});

describe('updateUserPreferences', () => {
  it('merges edits into an existing customer without clobbering untouched fields', async () => {
    const profile = await addUser('Preference Editor');
    const first = await updateUserPreferences(profile.phone, { dietary: 'veg' });
    expect(first?.preferences).toMatchObject({ dietary: 'veg', cuisines: [] });

    const second = await updateUserPreferences(profile.phone, { cuisines: ['italian', 'thai'] });
    expect(second?.preferences).toMatchObject({ dietary: 'veg', cuisines: ['italian', 'thai'] });
  });

  it('returns null for a phone with no profile row', async () => {
    const result = await updateUserPreferences('whatsapp:+910000099999', { dietary: 'vegan' });
    expect(result).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('assumes +91 (India) when no country code is given, matching every seeded address', () => {
    expect(normalizePhone('98765 43210')).toBe('whatsapp:+919876543210');
  });

  it('keeps an explicit country code as-is', () => {
    expect(normalizePhone('+1 (555) 123-0099')).toBe('whatsapp:+15551230099');
  });
});

describe('isPlausiblePhone', () => {
  it('accepts a normalized number with a real digit count', () => {
    expect(isPlausiblePhone('whatsapp:+919876543210')).toBe(true);
  });

  it('rejects junk that normalized to too few digits', () => {
    expect(isPlausiblePhone(normalizePhone('abc'))).toBe(false);
  });
});

describe('isPhoneTaken', () => {
  it('is true for a seeded user and false for an unused number', async () => {
    expect(await isPhoneTaken('whatsapp:+15551230001')).toBe(true);
    expect(await isPhoneTaken('whatsapp:+910000000000')).toBe(false);
  });

  it('is true for a phone just registered via addUser', async () => {
    const profile = await addUser('Just Added', 'whatsapp:+919000011111');
    expect(await isPhoneTaken(profile.phone)).toBe(true);
  });
});
