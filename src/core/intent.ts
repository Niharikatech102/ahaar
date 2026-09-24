export type GlobalCommand = 'MENU' | 'HELP' | 'STATUS' | 'CANCEL';

const GLOBAL_COMMANDS: GlobalCommand[] = ['MENU', 'HELP', 'STATUS', 'CANCEL'];

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
