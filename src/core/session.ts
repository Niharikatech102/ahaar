import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { createLogger } from '../logger.js';
import type { Order } from '../domain/order.js';
import type { CatalogEntry, Recommendation } from '../domain/types.js';

const log = createLogger('session');

export type ConversationState =
  | 'IDLE'
  | 'AWAITING_SELECTION'
  | 'AWAITING_QUANTITY'
  | 'AWAITING_ADDRESS'
  | 'AWAITING_PROMO'
  | 'AWAITING_CONFIRM';

export interface Session {
  phone: string;
  state: ConversationState;
  shownRecommendations: Recommendation[];
  selected: CatalogEntry | null;
  quantity: number | null;
  address: string | null;
  appliedPromoCode: string | null;
  appliedDiscount: number;
  currentOrder: Order | null;
  updatedAt: number;
}

export function freshSession(phone: string, now: number): Session {
  return {
    phone,
    state: 'IDLE',
    shownRecommendations: [],
    selected: null,
    quantity: null,
    address: null,
    appliedPromoCode: null,
    appliedDiscount: 0,
    currentOrder: null,
    updatedAt: now,
  };
}

/** Resets everything about the in-progress order, keeping the last placed order for STATUS lookups. */
export function resetToIdle(session: Session, now: number): Session {
  return {
    ...session,
    state: 'IDLE',
    shownRecommendations: [],
    selected: null,
    quantity: null,
    address: null,
    appliedPromoCode: null,
    appliedDiscount: 0,
    updatedAt: now,
  };
}

export interface SessionStoreOptions {
  /** When false, sessions live in memory only - used in tests. */
  persist?: boolean;
}

/**
 * Per-phone-number session store. Persistence is a fire-and-forget JSON
 * snapshot on disk (src/data/sessions.json, gitignored) so a dev-server
 * restart doesn't lose in-flight conversations; it is not a source of truth
 * for anything beyond local demo convenience.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly persist: boolean;
  private readonly filePath = path.join(DATA_DIR, 'sessions.json');

  constructor(options: SessionStoreOptions = {}) {
    this.persist = options.persist ?? true;
    if (this.persist) this.load();
  }

  get(phone: string, now: number): Session {
    const existing = this.sessions.get(phone);
    if (existing) return existing;
    const created = freshSession(phone, now);
    this.sessions.set(phone, created);
    return created;
  }

  set(session: Session): void {
    this.sessions.set(session.phone, session);
    if (this.persist) this.scheduleSave();
  }

  private saveTimer: NodeJS.Timeout | null = null;

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeToDisk();
    }, 200);
    this.saveTimer.unref?.();
  }

  private writeToDisk(): void {
    try {
      const data = JSON.stringify(Array.from(this.sessions.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf-8');
    } catch (err) {
      log.error('failed to persist sessions', err);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Session[];
      for (const session of parsed) this.sessions.set(session.phone, session);
      log.info(`loaded ${parsed.length} session(s) from disk`);
    } catch (err) {
      log.error('failed to load sessions, starting fresh', err);
    }
  }
}
