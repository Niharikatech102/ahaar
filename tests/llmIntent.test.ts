import { describe, expect, it } from 'vitest';
import { extractParsedQuery, parseQueryWithLLM } from '../src/core/llmIntent.js';

describe('parseQueryWithLLM', () => {
  it('returns null immediately with no API key configured, making no network call', async () => {
    // tests/setup.ts clears GROQ_API_KEY before any src module loads, so this
    // exercises the exact path the demo takes with no Groq key set at all.
    const start = Date.now();
    const result = await parseQueryWithLLM('something spicy under 300');
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(50);
  });
});

describe('extractParsedQuery', () => {
  it('parses a well-formed Groq JSON response into a ParsedQuery', () => {
    const content = JSON.stringify({ dish: 'spicy chinese', vegOnly: false, maxPrice: 300 });
    const result = extractParsedQuery(content, 'something spicy under 300');
    expect(result).toEqual({ raw: 'spicy chinese', vegOnly: false, maxPrice: 300 });
  });

  it('falls back to the original text when the model returns an empty dish', () => {
    const content = JSON.stringify({ dish: '', vegOnly: false, maxPrice: null });
    const result = extractParsedQuery(content, 'asdkjasd');
    expect(result?.raw).toBe('asdkjasd');
  });

  it('maps a null maxPrice to undefined', () => {
    const content = JSON.stringify({ dish: 'veg biryani', vegOnly: true, maxPrice: null });
    const result = extractParsedQuery(content, 'veg biryani');
    expect(result?.maxPrice).toBeUndefined();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    const result = extractParsedQuery('not valid json{{{', 'veg biryani');
    expect(result).toBeNull();
  });

  it('returns null when the required "dish" field is missing', () => {
    const content = JSON.stringify({ vegOnly: true, maxPrice: 200 });
    const result = extractParsedQuery(content, 'veg biryani');
    expect(result).toBeNull();
  });
});
