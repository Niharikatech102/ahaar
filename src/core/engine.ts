import { getProfileOrGuest } from '../domain/users.js';
import { handleMessage } from './stateMachine.js';
import { parseGlobalCommand, parseSelection } from './intent.js';
import { parseQueryWithLLM } from './llmIntent.js';
import type { SessionStore } from './session.js';

export interface EngineResult {
  replies: string[];
  /** The current order's id after this turn, if the user has ever placed one - lets a channel subscribe to live status. */
  orderId: string | null;
}

/**
 * Shared entry point for every channel adapter: loads the session for this
 * phone number, resolves the user's profile (or a cold-start guest profile),
 * optionally runs the LLM intent layer for a fresh free-text search, runs
 * the pure state machine, and persists the result. Keeping this in one
 * place means the simulator and Twilio adapters can't drift on wiring.
 */
export async function processMessage(
  store: SessionStore,
  phone: string,
  text: string,
  now: number = Date.now(),
): Promise<EngineResult> {
  const session = store.get(phone, now);
  const profile = getProfileOrGuest(phone);

  // Only worth calling the LLM for a fresh free-text search. That's either
  // a genuinely new search (state IDLE), or a user retyping a dish instead
  // of picking 1/2/3 while looking at recommendations - stateMachine.ts's
  // handleAwaitingSelection() falls back to treating that as a new search
  // too, so this condition has to mirror it exactly or the LLM gets skipped
  // for a case that's actually a fresh search by the time it reaches there.
  const isRetypedSearchDuringSelection =
    session.state === 'AWAITING_SELECTION' && parseSelection(text) === null;
  const isFreshSearch =
    text.trim() !== '' &&
    parseGlobalCommand(text) === null &&
    (session.state === 'IDLE' || isRetypedSearchDuringSelection);
  const parsedQueryOverride = isFreshSearch ? (await parseQueryWithLLM(text)) ?? undefined : undefined;

  const { session: nextSession, replies } = handleMessage(session, text, {
    profile,
    now,
    parsedQueryOverride,
  });
  store.set(nextSession);
  return { replies, orderId: nextSession.currentOrder?.id ?? null };
}
