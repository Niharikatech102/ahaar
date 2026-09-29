import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { ParsedQuery } from './intent.js';

const log = createLogger('llm-intent');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 4000;

// Shared between both providers - Groq gets it via response_format's
// json_schema, Claude gets it as a forced tool's input_schema. Same shape,
// same fields, so extractParsedQuery() below works for either one.
const QUERY_SCHEMA = {
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
} as const;

const RESPONSE_SCHEMA = { name: 'food_query', strict: true, schema: QUERY_SCHEMA } as const;

const SYSTEM_PROMPT =
  'Extract structured search filters from a WhatsApp food-order message. Return only the JSON object matching the schema - no commentary.';

interface LlmResponseBody {
  dish: string;
  vegOnly: boolean;
  maxPrice: number | null;
}

/** Turns a provider's JSON response body into our ParsedQuery shape. Exported for unit testing without a network call. */
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
 * Uses the operator's own Anthropic key (BYOK - never bundled, read straight
 * from env in config.ts) to turn noisy free text ("something spicy under
 * 300, not too far") into a clean search phrase plus structured filters.
 * Forces a tool call so the model can't reply with anything but the schema.
 * Returns null on any failure - bad key, network error, timeout, malformed
 * response - so the caller falls back the same way the Groq path does.
 */
async function parseWithAnthropic(text: string): Promise<ParsedQuery | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.anthropic.model,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
        tools: [
          {
            name: 'food_query',
            description: 'Structured search filters extracted from the message.',
            input_schema: QUERY_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'food_query' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      log.warn(`anthropic request failed with status ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    const toolUse = data.content?.find((block) => block.type === 'tool_use' && block.name === 'food_query');
    if (!toolUse) return null;

    return extractParsedQuery(JSON.stringify(toolUse.input), text);
  } catch (err) {
    log.warn('anthropic request errored, falling back to keyword parser', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Uses Groq's free-tier API for the same extraction (see parseWithAnthropic)
 * - this is the original, unmodified path from before BYOK was added, kept
 * as the no-key-required default.
 */
async function parseWithGroq(text: string): Promise<ParsedQuery | null> {
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

/**
 * Entry point used by core/engine.ts - unchanged signature regardless of
 * which provider (if any) is configured. Tries the operator's own Anthropic
 * key first when present (BYOK, config.ts reads it from env - never
 * bundled), then the Groq free-tier key, then gives up and returns null so
 * the caller falls back to the regex parser in core/intent.ts. The app
 * works fully with zero keys configured either way.
 */
export async function parseQueryWithLLM(text: string): Promise<ParsedQuery | null> {
  if (config.anthropic.apiKey) return parseWithAnthropic(text);
  if (config.groq.apiKey) return parseWithGroq(text);
  return null;
}
