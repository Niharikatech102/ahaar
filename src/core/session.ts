import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DATA_DIR } from '../config.js';
import { createLogger } from '../logger.js';
import { getDb, type Db } from '../db/client.js';
import { sessions as sessionsTable } from '../db/schema.js';
import type { CartItem, Order, PaymentMethod } from '../domain/order.js';
import type { CatalogEntry, Recommendation } from '../domain/types.js';

const log = createLogger('session');

export type ConversationState =
  | 'IDLE'
  | 'AWAITING_SELECTION'
  | 'AWAITING_QUANTITY'
  | 'AWAITING_ADDRESS'
  | 'AWAITING_PROMO'
  | 'AWAITING_PAYMENT'
  | 'AWAITING_CONFIRM';

export interface Session {
  phone: string;
  state: ConversationState;
  shownRecommendations: Recommendation[];
  /** The dish currently being configured (between picking it and confirming a quantity) - not yet in the cart. */
  selected: CatalogEntry | null;
  quantity: number | null;
  /** The persistent multi-item cart. Survives MENU/CANCEL; only cleared by CONFIRM or CLEAR CART. */
  cart: CartItem[];
  address: string | null;
  appliedPromoCode: string | null;
  appliedDiscount: number;
  /** Picked during AWAITING_PAYMENT; carried onto the placed Order. Demo-only, no real payment integration. */
  paymentMethod: PaymentMethod | null;
  currentOrder: Order | null;
  /** Order id awaiting a reply to the post-delivery rating prompt, or null if none is pending. */
  pendingRatingOrderId: string | null;
  /** Order id we've already shown the rating prompt for, so it's never asked twice. */
  ratingHandledForOrderId: string | null;
  updatedAt: number;
}

export function freshSession(phone: string, now: number): Session {
  return {
    phone,
    state: 'IDLE',
    shownRecommendations: [],
    selected: null,
    quantity: null,
    cart: [],
    address: null,
    appliedPromoCode: null,
    appliedDiscount: 0,
    paymentMethod: null,
    currentOrder: null,
    pendingRatingOrderId: null,
    ratingHandledForOrderId: null,
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
    paymentMethod: null,
    updatedAt: now,
  };
}

export interface SessionStoreOptions {
  /** When false, sessions live in memory only - used in tests. */
  persist?: boolean;
}

/**
 * Per-phone-number session store, with an in-memory Map as a fast-path cache
 * in front of whichever durable backend is available: Postgres (when
 * DATABASE_URL is set - the only thing that actually survives a Vercel
 * serverless instance recycling) or, for local dev without a DB, a debounced
 * JSON snapshot on disk (src/data/sessions.json, gitignored).
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly persist: boolean;
  private readonly filePath = path.join(DATA_DIR, 'sessions.json');
  private readonly db: Db | null;

  constructor(options: SessionStoreOptions = {}) {
    this.persist = options.persist ?? true;
    this.db = getDb();
    if (this.persist && !this.db) this.load();
  }

  async get(phone: string, now: number): Promise<Session> {
    const cached = this.sessions.get(phone);
    if (cached) return cached;

    if (this.db) {
      const fromDb = await this.fetchFromDb(this.db, phone);
      if (fromDb) {
        this.sessions.set(phone, fromDb);
        return fromDb;
      }
    }

    const created = freshSession(phone, now);
    this.sessions.set(phone, created);
    return created;
  }

  async set(session: Session): Promise<void> {
    this.sessions.set(session.phone, session);
    if (this.db) {
      await this.saveToDb(this.db, session);
      return;
    }
    if (this.persist) this.scheduleSave();
  }

  private async fetchFromDb(db: Db, phone: string): Promise<Session | null> {
    try {
      const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.phone, phone)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        phone: row.phone,
        state: row.state,
        shownRecommendations: row.shownRecommendations,
        selected: row.selected,
        quantity: row.quantity,
        cart: row.cart,
        address: row.address,
        appliedPromoCode: row.appliedPromoCode,
        appliedDiscount: row.appliedDiscount,
        paymentMethod: row.paymentMethod,
        currentOrder: row.currentOrder,
        pendingRatingOrderId: row.pendingRatingOrderId,
        ratingHandledForOrderId: row.ratingHandledForOrderId,
        updatedAt: row.updatedAt.getTime(),
      };
    } catch (err) {
      log.error('failed to load session from Postgres', err);
      return null;
    }
  }

  private async saveToDb(db: Db, session: Session): Promise<void> {
    try {
      await db
        .insert(sessionsTable)
        .values({
          phone: session.phone,
          state: session.state,
          shownRecommendations: session.shownRecommendations,
          selected: session.selected,
          quantity: session.quantity,
          cart: session.cart,
          address: session.address,
          appliedPromoCode: session.appliedPromoCode,
          appliedDiscount: session.appliedDiscount,
          paymentMethod: session.paymentMethod,
          currentOrder: session.currentOrder,
          pendingRatingOrderId: session.pendingRatingOrderId,
          ratingHandledForOrderId: session.ratingHandledForOrderId,
          updatedAt: new Date(session.updatedAt),
        })
        .onConflictDoUpdate({
          target: sessionsTable.phone,
          set: {
            state: session.state,
            shownRecommendations: session.shownRecommendations,
            selected: session.selected,
            quantity: session.quantity,
            cart: session.cart,
            address: session.address,
            appliedPromoCode: session.appliedPromoCode,
            appliedDiscount: session.appliedDiscount,
            paymentMethod: session.paymentMethod,
            currentOrder: session.currentOrder,
            pendingRatingOrderId: session.pendingRatingOrderId,
            ratingHandledForOrderId: session.ratingHandledForOrderId,
            updatedAt: new Date(session.updatedAt),
          },
        });
    } catch (err) {
      log.error('failed to persist session to Postgres', err);
    }
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
