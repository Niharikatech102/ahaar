import { describe, expect, it } from 'vitest';
import {
  addUser,
  getAllUsers,
  getUserByPhone,
  isPhoneTaken,
  isPlausiblePhone,
  normalizePhone,
} from '../src/domain/users.js';

describe('addUser', () => {
  it('registers a new customer with no history and no saved address', () => {
    const profile = addUser('Priya');
    expect(profile.name).toBe('Priya');
    expect(profile.phone).toMatch(/^whatsapp:\+1999\d+$/);
    expect(profile.orderHistory).toEqual([]);
    expect(profile.addresses).toEqual([]);
  });

  it('is immediately findable by phone and appears in the full user list', () => {
    const profile = addUser('Karan');
    expect(getUserByPhone(profile.phone)?.name).toBe('Karan');
    expect(getAllUsers().some((u) => u.phone === profile.phone)).toBe(true);
  });

  it('gives two different customers distinct phone numbers', () => {
    const a = addUser('Customer A');
    const b = addUser('Customer B');
    expect(a.phone).not.toBe(b.phone);
  });

  it('does not affect the seeded demo users', () => {
    const before = getAllUsers().filter((u) => u.phone === 'whatsapp:+15551230001');
    addUser('Someone New');
    const after = getAllUsers().filter((u) => u.phone === 'whatsapp:+15551230001');
    expect(after).toEqual(before);
  });

  it('saves a provided phone and address as the customer default address', () => {
    const profile = addUser('Full Details', 'whatsapp:+919876543210', '42 Custom Lane, Pune');
    expect(profile.phone).toBe('whatsapp:+919876543210');
    expect(profile.addresses).toEqual([
      { id: 'a1', label: 'Home', line: '42 Custom Lane, Pune', isDefault: true },
    ]);
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
  it('is true for a seeded user and false for an unused number', () => {
    expect(isPhoneTaken('whatsapp:+15551230001')).toBe(true);
    expect(isPhoneTaken('whatsapp:+910000000000')).toBe(false);
  });

  it('is true for a phone just registered via addUser', () => {
    const profile = addUser('Just Added', 'whatsapp:+919000011111');
    expect(isPhoneTaken(profile.phone)).toBe(true);
  });
});
