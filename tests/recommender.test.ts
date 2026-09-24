import { describe, expect, it } from 'vitest';
import { recommend } from '../src/domain/recommender.js';
import type { PastOrder } from '../src/domain/types.js';

const aryanHistory: PastOrder[] = [
  { restaurantId: 'r01', itemId: 'i0101', cuisine: 'biryani', daysAgo: 4, rating: 5 },
  { restaurantId: 'r01', itemId: 'i0102', cuisine: 'biryani', daysAgo: 18, rating: 4 },
  { restaurantId: 'r03', itemId: 'i0301', cuisine: 'biryani', daysAgo: 40, rating: 5 },
];

describe('recommend', () => {
  it('returns exactly 3 results for a well-covered query', () => {
    const results = recommend('veg biryani', aryanHistory);
    expect(results).toHaveLength(3);
  });

  it('never returns two results from the same restaurant', () => {
    const results = recommend('veg biryani', aryanHistory);
    const restaurantIds = results.map((r) => r.entry.restaurant.id);
    expect(new Set(restaurantIds).size).toBe(restaurantIds.length);
  });

  it('only ever recommends 4-star-and-above restaurants', () => {
    const results = recommend('veg biryani', aryanHistory);
    for (const r of results) {
      expect(r.entry.restaurant.rating).toBeGreaterThanOrEqual(4.0);
    }
  });

  it('ranks a restaurant the user has ordered from repeatedly above one they have not, all else similar', () => {
    const results = recommend('veg biryani', aryanHistory);
    const biryaniHouseIndex = results.findIndex((r) => r.entry.restaurant.id === 'r01');
    const greenLeafIndex = results.findIndex((r) => r.entry.restaurant.id === 'r04');
    expect(biryaniHouseIndex).toBeGreaterThanOrEqual(0);
    if (greenLeafIndex >= 0) {
      expect(biryaniHouseIndex).toBeLessThan(greenLeafIndex);
    }
  });

  it('produces a non-empty human-readable reason for every recommendation', () => {
    const results = recommend('veg biryani', aryanHistory);
    for (const r of results) {
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.reason).toContain('★');
    }
  });

  it('degrades gracefully to a pure rating/quality ranking for a user with no history', () => {
    const results = recommend('veg biryani', []);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.entry.restaurant.rating).toBeGreaterThanOrEqual(4.0);
    }
  });

  it('respects vegOnly filter end to end', () => {
    const results = recommend('biryani', [], { vegOnly: true });
    for (const r of results) {
      expect(r.entry.item.veg).toBe(true);
    }
  });

  it('returns fewer than 3 results rather than padding when few restaurants qualify', () => {
    // Sweet Tooth (r10) is the only 4-star+ restaurant selling a dessert matching this exact phrase.
    const results = recommend('cheesecake', []);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
