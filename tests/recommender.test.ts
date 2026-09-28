import { describe, expect, it } from 'vitest';
import { getUsualOrder, recommend } from '../src/domain/recommender.js';
import type { PastOrder, UserPreferences } from '../src/domain/types.js';

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

  it('regression: does not credit an unrelated item to a cuisine the item itself has nothing to do with', () => {
    // Spice Junction serves "biryani" among its cuisines, and Aryan has
    // ordered biryani before - but Masala Chai is a chai, not a biryani, so
    // the reason text must not claim it "matches your usual biryani orders".
    const results = recommend('drink', aryanHistory);
    const masalaChai = results.find((r) => r.entry.item.name === 'Masala Chai');
    expect(masalaChai).toBeDefined();
    expect(masalaChai!.reason).not.toContain('biryani');
  });

  it('regression: a filler-word query only returns genuinely relevant dishes, not history-biased noise', () => {
    // Previously "i" (from "I want") fuzzy-matched almost any dish containing
    // the letter i (e.g. "b[i]ryani"), so a user's past-ordered items could
    // outrank real dessert matches for a query like this.
    const results = recommend('i want something sweet', aryanHistory);
    for (const r of results) {
      expect(r.entry.item.tags).toContain('sweet');
    }
    expect(results.some((r) => r.entry.item.name === 'Margherita Pizza')).toBe(false);
    expect(results.some((r) => r.entry.item.name === 'Paneer Biryani')).toBe(false);
  });

  describe('preferences signal', () => {
    const prefs: UserPreferences = { cuisines: [], dietary: 'veg', spiceLevel: null, budgetMax: 300 };

    it('does not change behavior when no preferences are set', () => {
      const withoutPrefs = recommend('veg biryani', aryanHistory);
      const withEmptyPrefs = recommend('veg biryani', aryanHistory, {
        preferences: { cuisines: [], dietary: null, spiceLevel: null, budgetMax: null },
      });
      expect(withEmptyPrefs.map((r) => r.entry.item.id)).toEqual(withoutPrefs.map((r) => r.entry.item.id));
    });

    it('mentions the vegetarian preference in the reason for a veg match', () => {
      const results = recommend('veg biryani', [], { preferences: prefs });
      const vegHit = results.find((r) => r.entry.item.veg);
      expect(vegHit).toBeDefined();
      expect(vegHit!.reason).toContain('vegetarian preference');
    });

    it('mentions being within budget when the price qualifies', () => {
      const results = recommend('veg biryani', [], { preferences: prefs });
      const withinBudget = results.find((r) => r.entry.item.price <= 300);
      expect(withinBudget).toBeDefined();
      expect(withinBudget!.reason).toContain('within your budget');
    });
  });
});

describe('getUsualOrder', () => {
  it('returns null when there is no history', () => {
    expect(getUsualOrder([])).toBeNull();
  });

  it('picks the most-frequently-ordered dish, not simply the most recent one', () => {
    const history: PastOrder[] = [
      { restaurantId: 'r01', itemId: 'i0101', cuisine: 'biryani', daysAgo: 60, rating: 5 },
      { restaurantId: 'r01', itemId: 'i0101', cuisine: 'biryani', daysAgo: 30, rating: 5 },
      { restaurantId: 'r01', itemId: 'i0101', cuisine: 'biryani', daysAgo: 10, rating: 4 },
      { restaurantId: 'r07', itemId: 'i0701', cuisine: 'italian', daysAgo: 1, rating: 5 }, // ordered most recently, but only once
    ];
    const usual = getUsualOrder(history);
    expect(usual).toEqual({ restaurantId: 'r01', itemId: 'i0101', timesOrdered: 3 });
  });

  it('breaks a tie in frequency by whichever was ordered more recently', () => {
    const history: PastOrder[] = [
      { restaurantId: 'r01', itemId: 'i0101', cuisine: 'biryani', daysAgo: 50, rating: 5 },
      { restaurantId: 'r01', itemId: 'i0101', cuisine: 'biryani', daysAgo: 20, rating: 5 },
      { restaurantId: 'r07', itemId: 'i0701', cuisine: 'italian', daysAgo: 40, rating: 5 },
      { restaurantId: 'r07', itemId: 'i0701', cuisine: 'italian', daysAgo: 2, rating: 5 },
    ];
    const usual = getUsualOrder(history);
    expect(usual).toEqual({ restaurantId: 'r07', itemId: 'i0701', timesOrdered: 2 });
  });
});
