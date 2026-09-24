import { getProfileOrGuest } from '../domain/users.js';
import { handleMessage } from './stateMachine.js';
import { parseGlobalCommand } from './intent.js';
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

  // Only worth calling the LLM for a fresh free-text search - global
  // commands and every other state are handled deterministically already.
  const isFreshSearch = session.state === 'IDLE' && text.trim() !== '' && parseGlobalCommand(text) === null;
  const parsedQueryOverride = isFreshSearch ? (await parseQueryWithLLM(text)) ?? undefined : undefined;

  const { session: nextSession, replies } = handleMessage(session, text, {
    profile,
    now,
    parsedQueryOverride,
  });
  store.set(nextSession);
  return { replies, orderId: nextSession.currentOrder?.id ?? null };
}
