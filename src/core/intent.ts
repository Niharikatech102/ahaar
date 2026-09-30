export type GlobalCommand =
  | 'MENU' | 'HELP' | 'STATUS' | 'CANCEL' | 'REORDER'
  | 'CART' | 'VIEW CART' | 'SHOW CART' | 'MY CART'
  | 'CHECKOUT' | 'CLEAR CART' | 'EMPTY CART'
  | 'MY USUAL' | 'USUAL' | 'ORDER MY USUAL'
  | 'GIVE ME MORE' | 'MORE' | 'SHOW MORE' | 'MORE OPTIONS' | 'MORE RECOMMENDATIONS';

const GLOBAL_COMMANDS: GlobalCommand[] = [
  'MENU', 'HELP', 'STATUS', 'CANCEL', 'REORDER',
  'CART', 'VIEW CART', 'SHOW CART', 'MY CART',
  'CHECKOUT', 'CLEAR CART', 'EMPTY CART',
  'MY USUAL', 'USUAL', 'ORDER MY USUAL',
  'GIVE ME MORE', 'MORE', 'SHOW MORE', 'MORE OPTIONS', 'MORE RECOMMENDATIONS',
];

export function parseGlobalCommand(text: string): GlobalCommand | null {
  const normalized = text.trim().toUpperCase();
  return (GLOBAL_COMMANDS as string[]).includes(normalized) ? (normalized as GlobalCommand) : null;
}

export function isWord(text: string, word: string): boolean {
  return text.trim().toUpperCase() === word.toUpperCase();
}

/** Parses "1" / "2." / "option 3" / "3rd" into a 1-based index, or null if not a selection. */
export function parseSelection(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  const match = trimmed.match(/^(?:option\s*)?(\d+)(?:st|nd|rd|th)?\.?$/);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(n) ? n : null;
}

/** Parses a positive integer quantity, capped to a sane order size. */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\d+)$/);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}

/** Parses a bare 1-5 star rating reply, or null if the text isn't one. */
export function parseRating(text: string): 1 | 2 | 3 | 4 | 5 | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^([1-5])$/);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '', 10) as 1 | 2 | 3 | 4 | 5;
}

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.,!?]+$/, '').trim();
}

/** "Add pizza" / "add a coffee" -> "pizza" / "coffee". Null if not an add command. */
export function parseAddCommand(text: string): string | null {
  const match = stripTrailingPunctuation(text).match(/^add\s+(?:a\s+|an\s+|the\s+|one\s+|some\s+)?(.+)$/i);
  const query = match?.[1]?.trim();
  return query || null;
}

/** "Remove pizza" / "remove the coffee" -> "pizza" / "coffee". Null if not a remove command. */
export function parseRemoveCommand(text: string): string | null {
  const match = stripTrailingPunctuation(text).match(/^remove\s+(?:the\s+)?(.+)$/i);
  const query = match?.[1]?.trim();
  return query || null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "two" -> 2, "3" -> 3. Null if not a recognizable positive count. */
function parseWordOrDigitNumber(word: string): number | null {
  const lower = word.toLowerCase();
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower]!;
  const n = Number.parseInt(word, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface QuantityUpdateCommand {
  /** The cart line to target, by name fragment, or "that"/"it" meaning "whatever was added last". */
  target: string;
  quantity: number;
}

/** "Make the coffee two" / "make that 3" -> { target, quantity }. Null if not this shape. */
export function parseQuantityUpdateCommand(text: string): QuantityUpdateCommand | null {
  const match = stripTrailingPunctuation(text).match(/^make\s+(?:the\s+)?(.*?)\s+(\w+)$/i);
  if (!match) return null;
  const quantity = parseWordOrDigitNumber(match[2] ?? '');
  if (quantity === null) return null;
  return { target: match[1]?.trim() || 'that', quantity };
}

// Loose enough to catch real phrasing variance ("apply the best discount",
// "what's the best deal", "give me the biggest offer") without needing the
// LLM - a user rarely says exactly "BEST DISCOUNT" and nothing else.
const BEST_DISCOUNT_PATTERN = /\b(?:best|biggest|maximum|highest)\s+(?:discount|deal|offer|promo|savings?)\b/i;

export function isBestDiscountRequest(text: string): boolean {
  return BEST_DISCOUNT_PATTERN.test(text.trim());
}

const TOTAL_REQUEST_PATTERN = /^(?:what'?s?\s+(?:is\s+)?)?my\s+total\??$|^total\??$|^what'?s?\s+the\s+total\??$/i;

export function isTotalRequest(text: string): boolean {
  return TOTAL_REQUEST_PATTERN.test(text.trim());
}

export interface ParsedQuery {
  raw: string;
  vegOnly: boolean;
  maxPrice?: number;
}

const VEG_PATTERN = /\bveg\b/i;
const NON_VEG_PATTERN = /\bnon[\s-]?veg\b/i;
const BUDGET_PATTERN = /\b(?:under|below|less than)\s*(?:rs\.?|₹)?\s*(\d+)/i;

export function parseQuery(text: string): ParsedQuery {
  const raw = text.trim();
  const vegOnly = VEG_PATTERN.test(raw) && !NON_VEG_PATTERN.test(raw);
  const budgetMatch = raw.match(BUDGET_PATTERN);
  const maxPrice = budgetMatch?.[1] ? Number.parseInt(budgetMatch[1], 10) : undefined;

  return { raw, vegOnly, maxPrice };
}

/**
 * True when the message itself explicitly asks for non-veg - the one signal
 * strong enough to override a saved vegetarian/vegan preference for this one
 * search, rather than silently filtering out what was just asked for.
 */
export function explicitlyRequestsNonVeg(text: string): boolean {
  return NON_VEG_PATTERN.test(text);
}
