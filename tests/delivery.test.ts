import { describe, expect, it } from 'vitest';
import { deliveryPartnerFor, isPartnerAssigned, statusAt, statusMessage } from '../src/domain/delivery.js';

const PLACED_AT = 1_700_000_000_000;

describe('statusAt', () => {
  it('walks through every stage in order as time passes', () => {
    expect(statusAt(PLACED_AT, PLACED_AT)).toBe('CONFIRMED');
    expect(statusAt(PLACED_AT, PLACED_AT + 15_000)).toBe('PREPARING');
    expect(statusAt(PLACED_AT, PLACED_AT + 35_000)).toBe('PICKED_UP');
    expect(statusAt(PLACED_AT, PLACED_AT + 55_000)).toBe('OUT_FOR_DELIVERY');
    expect(statusAt(PLACED_AT, PLACED_AT + 90_000)).toBe('DELIVERED');
  });

  it('has a human-readable message for every stage', () => {
    for (const status of ['CONFIRMED', 'PREPARING', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      expect(statusMessage(status).length).toBeGreaterThan(0);
    }
  });
});

describe('isPartnerAssigned', () => {
  it('is false before pickup and true from pickup onward', () => {
    expect(isPartnerAssigned('CONFIRMED')).toBe(false);
    expect(isPartnerAssigned('PREPARING')).toBe(false);
    expect(isPartnerAssigned('PICKED_UP')).toBe(true);
    expect(isPartnerAssigned('OUT_FOR_DELIVERY')).toBe(true);
    expect(isPartnerAssigned('DELIVERED')).toBe(true);
  });
});

describe('deliveryPartnerFor', () => {
  it('always assigns the same partner to the same order id', () => {
    const first = deliveryPartnerFor('ORD-ABC123');
    const second = deliveryPartnerFor('ORD-ABC123');
    expect(second).toEqual(first);
  });

  it('can assign different partners to different order ids', () => {
    const names = new Set(['ORD-1', 'ORD-2', 'ORD-3', 'ORD-4', 'ORD-5'].map((id) => deliveryPartnerFor(id).name));
    expect(names.size).toBeGreaterThan(1);
  });
});
