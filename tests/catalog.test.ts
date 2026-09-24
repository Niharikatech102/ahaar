import { describe, expect, it } from 'vitest';
import { getAllRestaurants, matchScore, searchCatalog, tokenize } from '../src/domain/catalog.js';

describe('catalog data', () => {
  it('loads all restaurants with valid ratings and at least one item each', () => {
    const restaurants = getAllRestaurants();
    expect(restaurants.length).toBeGreaterThanOrEqual(12);
    for (const r of restaurants) {
      expect(r.rating).toBeGreaterThan(0);
      expect(r.rating).toBeLessThanOrEqual(5);
      expect(r.items.length).toBeGreaterThan(0);
    }
  });
});

describe('searchCatalog', () => {
  it('excludes restaurants rated below 4 stars', () => {
    const results = searchCatalog('veg biryani');
    const belowThreshold = results.filter((e) => e.restaurant.rating < 4.0);
    expect(belowThreshold).toHaveLength(0);
    // r06 (3.8) and r12 (3.6) both sell "Veg Biryani" - confirms the filter is doing real work.
    expect(results.some((e) => e.restaurant.id === 'r06')).toBe(false);
    expect(results.some((e) => e.restaurant.id === 'r12')).toBe(false);
  });

  it('finds veg biryani across multiple qualifying restaurants', () => {
    const results = searchCatalog('veg biryani');
    const names = results.map((e) => `${e.restaurant.name}:${e.item.name}`);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(names.some((n) => n.includes('Biryani House'))).toBe(true);
  });

  it('respects vegOnly and maxPrice constraints', () => {
    const results = searchCatalog('biryani', { vegOnly: true, maxPrice: 200 });
    for (const e of results) {
      expect(e.item.veg).toBe(true);
      expect(e.item.price).toBeLessThanOrEqual(200);
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns nothing for a query that matches no item', () => {
    const results = searchCatalog('xyznonexistentdish');
    expect(results).toHaveLength(0);
  });

  it('matchScore rewards tag and cuisine overlap', () => {
    const restaurants = getAllRestaurants();
    const biryaniHouse = restaurants.find((r) => r.id === 'r01')!;
    const vegBiryani = biryaniHouse.items.find((i) => i.id === 'i0101')!;
    const score = matchScore({ restaurant: biryaniHouse, item: vegBiryani }, ['veg', 'biryani']);
    expect(score).toBe(1);
  });

  describe('tokenize', () => {
    it('drops filler words that would otherwise pollute matching', () => {
      expect(tokenize('i want something sweet')).toEqual(['sweet']);
      expect(tokenize('Veg Biryani')).toEqual(['veg', 'biryani']);
    });
  });

  it('regression: a filler-word query only returns dishes actually matching the meaningful token', () => {
    // Before the tokenize() stopword fix, the token "i" fuzzy-matched any
    // dish containing that letter (e.g. "b[i]ryani", "prem[i]um") via the
    // substring check in matchScore, so this query returned biryanis and
    // pizza alongside real desserts.
    const results = searchCatalog('i want something sweet');
    expect(results.length).toBeGreaterThan(0);
    for (const e of results) {
      expect(e.item.tags).toContain('sweet');
    }
  });
});
