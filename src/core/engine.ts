import { getProfileOrGuest } from '../domain/users.js';
import { handleMessage } from './stateMachine.js';
import type { SessionStore } from './session.js';

export interface EngineResult {
  replies: string[];
  /** The current order's id after this turn, if the user has ever placed one - lets a channel subscribe to live status. */
  orderId: string | null;
}

/**
 * Shared entry point for every channel adapter: loads the session for this
 * phone number, resolves the user's profile (or a cold-start guest profile),
 * runs the pure state machine, and persists the result. Keeping this in one
 * place means the simulator and Twilio adapters can't drift on wiring.
 */
export function processMessage(
  store: SessionStore,
  phone: string,
  text: string,
  now: number = Date.now(),
): EngineResult {
  const session = store.get(phone, now);
  const profile = getProfileOrGuest(phone);
  const { session: nextSession, replies } = handleMessage(session, text, { profile, now });
  store.set(nextSession);
  return { replies, orderId: nextSession.currentOrder?.id ?? null };
}
