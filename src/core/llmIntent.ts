import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { ParsedQuery } from './intent.js';

const log = createLogger('llm-intent');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 4000;

const RESPONSE_SCHEMA = {
  name: 'food_query',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      dish: {
        type: 'string',
        description:
          'A short search phrase capturing the dish or cuisine being requested, e.g. "spicy chinese" or "veg biryani". Empty string if nothing food-related was said.',
      },
      vegOnly: {
        type: 'boolean',
        description: 'True only if the user explicitly asked for vegetarian food.',
      },
      maxPrice: {
        type: ['integer', 'null'],
        description: 'Maximum price in rupees if the user mentioned a budget, otherwise null.',
      },
    },
    required: ['dish', 'vegOnly', 'maxPrice'],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT =
  'Extract structured search filters from a WhatsApp food-order message. Return only the JSON object matching the schema - no commentary.';

interface LlmResponseBody {
  dish: string;
  vegOnly: boolean;
  maxPrice: number | null;
}

/** Turns a Groq JSON response body into our ParsedQuery shape. Exported for unit testing without a network call. */
export function extractParsedQuery(content: string, fallbackRaw: string): ParsedQuery | null {
  try {
    const parsed = JSON.parse(content) as Partial<LlmResponseBody>;
    if (typeof parsed.dish !== 'string') return null;

    return {
      raw: parsed.dish.trim() || fallbackRaw.trim(),
      vegOnly: Boolean(parsed.vegOnly),
      maxPrice: typeof parsed.maxPrice === 'number' ? parsed.maxPrice : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Uses Groq's free-tier API to turn noisy free text ("something spicy under
 * 300, not too far") into a clean search phrase plus structured filters.
 * Returns null on any failure - no key configured, network error, timeout,
 * bad response - so the caller falls back to the regex parser in intent.ts.
 * Never throws.
 */
export async function parseQueryWithLLM(text: string): Promise<ParsedQuery | null> {
  if (!config.groq.apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.groq.apiKey}`,
      },
      body: JSON.stringify({
        model: config.groq.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      log.warn(`groq request failed with status ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return extractParsedQuery(content, text);
  } catch (err) {
    log.warn('groq request errored, falling back to keyword parser', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
