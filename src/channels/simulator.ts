import { Router, type Request, type Response } from 'express';
import { processMessage } from '../core/engine.js';
import { addLineToCart } from '../core/stateMachine.js';
import type { Session, SessionStore } from '../core/session.js';
import {
  addUser,
  getAllUsers,
  getProfileOrGuest,
  isPhoneTaken,
  isPlausiblePhone,
  normalizePhone,
  updateUserPreferences,
} from '../domain/users.js';
import type { UserPreferences } from '../domain/types.js';
import { deliveryPartnerFor, isPartnerAssigned, statusAt } from '../domain/delivery.js';
import { computeBill, type CartItem } from '../domain/order.js';
import { getAllPromos } from '../domain/promos.js';
import { getAllRestaurants, getItemById, getRestaurantById, searchCatalog } from '../domain/catalog.js';
import { createComplaint, getComplaintsForUser, type ComplaintCategory } from '../domain/complaints.js';
import { createLogger } from '../logger.js';

const COMPLAINT_CATEGORIES: ComplaintCategory[] = ['LATE_DELIVERY', 'WRONG_ITEM', 'MISSING_ITEM', 'FOOD_QUALITY', 'OTHER'];

const log = createLogger('simulator');
const STREAM_INTERVAL_MS = 2000;

/** Partner is only meaningful once the order has actually been picked up. */
function partnerFor(orderId: string, status: ReturnType<typeof statusAt>) {
  return isPartnerAssigned(status) ? deliveryPartnerFor(orderId) : null;
}

/**
 * Zero-credential channel for the browser demo UI. A message is a plain
 * request/response; delivery status is pushed over Server-Sent Events so
 * the tracker card updates live without polling.
 */
export function createSimulatorRouter(store: SessionStore): Router {
  const router = Router();

  router.get('/users', async (_req: Request, res: Response) => {
    const allUsers = await getAllUsers();
    res.json({ users: allUsers.map((u) => ({ phone: u.phone, name: u.name })) });
  });

  router.post('/users', async (req: Request, res: Response) => {
    const { name, phone, address } = (req.body ?? {}) as {
      name?: unknown;
      phone?: unknown;
      address?: unknown;
    };
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    let resolvedPhone: string | undefined;
    if (typeof phone === 'string' && phone.trim()) {
      resolvedPhone = normalizePhone(phone);
      if (!isPlausiblePhone(resolvedPhone)) {
        res.status(400).json({ error: 'phone number looks invalid' });
        return;
      }
      if (await isPhoneTaken(resolvedPhone)) {
        res.status(409).json({ error: 'a customer with this phone number already exists' });
        return;
      }
    }

    const addressLine = typeof address === 'string' && address.trim() ? address.trim() : undefined;
    const profile = await addUser(name.trim(), resolvedPhone, addressLine);
    res.status(201).json({ phone: profile.phone, name: profile.name });
  });

  router.get('/profile', async (req: Request, res: Response) => {
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }
    const profile = await getProfileOrGuest(phone);
    res.json({ profile });
  });

  router.patch('/preferences', async (req: Request, res: Response) => {
    const { phone, preferences } = (req.body ?? {}) as { phone?: unknown; preferences?: unknown };
    if (typeof phone !== 'string' || !phone.trim() || typeof preferences !== 'object' || preferences === null) {
      res.status(400).json({ error: 'phone and preferences are required' });
      return;
    }

    const edits: Partial<UserPreferences> = {};
    const raw = preferences as Record<string, unknown>;
    if (Array.isArray(raw['cuisines']) && raw['cuisines'].every((c) => typeof c === 'string')) {
      edits.cuisines = raw['cuisines'] as string[];
    }
    if (raw['dietary'] === null || raw['dietary'] === 'veg' || raw['dietary'] === 'non-veg' || raw['dietary'] === 'vegan') {
      edits.dietary = raw['dietary'];
    }
    if (raw['spiceLevel'] === null || raw['spiceLevel'] === 'mild' || raw['spiceLevel'] === 'medium' || raw['spiceLevel'] === 'spicy') {
      edits.spiceLevel = raw['spiceLevel'];
    }
    if (raw['budgetMax'] === null || (typeof raw['budgetMax'] === 'number' && raw['budgetMax'] > 0)) {
      edits.budgetMax = raw['budgetMax'] as number | null;
    }

    const updated = await updateUserPreferences(phone, edits);
    if (!updated) {
      res.status(404).json({ error: 'no profile found for this phone - guests have nothing to save preferences against' });
      return;
    }
    res.json({ profile: updated });
  });

  function cartPayload(session: Session) {
    const bill = computeBill(session.cart, session.appliedDiscount, session.appliedPromoCode);
    return { cart: session.cart, bill };
  }

  /**
   * Cart edits from the right-panel UI (+/-, remove, clear) go through these
   * dedicated endpoints rather than faking a chat message - a button click
   * isn't something the user "said", so it shouldn't appear in the
   * transcript. They reuse the exact same cart-merge logic as the chat
   * ADD/REMOVE/MAKE commands (`addLineToCart`) and are only allowed while
   * the conversation is IDLE, same guard as those commands, so a UI click
   * can't corrupt an in-progress search/checkout flow.
   */
  router.get('/cart', async (req: Request, res: Response) => {
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }
    const session = await store.get(phone, Date.now());
    res.json(cartPayload(session));
  });

  router.post('/cart/items', async (req: Request, res: Response) => {
    const { phone, restaurantId, itemId, quantity } = (req.body ?? {}) as {
      phone?: unknown;
      restaurantId?: unknown;
      itemId?: unknown;
      quantity?: unknown;
    };
    if (typeof phone !== 'string' || !phone.trim() || typeof restaurantId !== 'string' || typeof itemId !== 'string') {
      res.status(400).json({ error: 'phone, restaurantId and itemId are required' });
      return;
    }
    const qty = typeof quantity === 'number' && quantity >= 1 && quantity <= 10 ? Math.round(quantity) : 1;

    const restaurant = getRestaurantById(restaurantId);
    const item = restaurant && getItemById(restaurantId, itemId);
    if (!restaurant || !item) {
      res.status(404).json({ error: 'no such dish in the catalog' });
      return;
    }

    const now = Date.now();
    const session = await store.get(phone, now);
    // AWAITING_SELECTION is allowed too - it's exactly the state right after
    // a search, when a recommendation card's "Add to Cart" button is what
    // the user clicks instead of typing 1/2/3. That resolves the pending
    // selection the same way answering it would, so it's cleared here too.
    if (session.state !== 'IDLE' && session.state !== 'AWAITING_SELECTION') {
      res.status(409).json({ error: 'finish or cancel the current conversation step before editing the cart' });
      return;
    }

    // Price/name always come from the catalog lookup above, never from the request body.
    const line: CartItem = {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      itemId: item.id,
      itemName: item.name,
      unitPrice: item.price,
      quantity: qty,
    };
    const nextSession: Session = {
      ...session,
      state: 'IDLE',
      shownRecommendations: [],
      selected: null,
      quantity: null,
      cart: addLineToCart(session.cart, line),
      updatedAt: now,
    };
    await store.set(nextSession);
    res.json(cartPayload(nextSession));
  });

  router.patch('/cart/items', async (req: Request, res: Response) => {
    const { phone, restaurantId, itemId, quantity } = (req.body ?? {}) as {
      phone?: unknown;
      restaurantId?: unknown;
      itemId?: unknown;
      quantity?: unknown;
    };
    if (
      typeof phone !== 'string' || !phone.trim() ||
      typeof restaurantId !== 'string' || typeof itemId !== 'string' ||
      typeof quantity !== 'number' || quantity < 1 || quantity > 10
    ) {
      res.status(400).json({ error: 'phone, restaurantId, itemId and a quantity between 1 and 10 are required' });
      return;
    }

    const now = Date.now();
    const session = await store.get(phone, now);
    if (session.state !== 'IDLE') {
      res.status(409).json({ error: 'finish or cancel the current conversation step before editing the cart' });
      return;
    }

    const idx = session.cart.findIndex((l) => l.restaurantId === restaurantId && l.itemId === itemId);
    if (idx === -1) {
      res.status(404).json({ error: 'that dish is not in the cart' });
      return;
    }
    const nextCart = [...session.cart];
    nextCart[idx] = { ...nextCart[idx]!, quantity: Math.round(quantity) };
    const nextSession: Session = { ...session, cart: nextCart, updatedAt: now };
    await store.set(nextSession);
    res.json(cartPayload(nextSession));
  });

  router.delete('/cart/items', async (req: Request, res: Response) => {
    const { phone, restaurantId, itemId } = (req.body ?? {}) as {
      phone?: unknown;
      restaurantId?: unknown;
      itemId?: unknown;
    };
    if (typeof phone !== 'string' || !phone.trim() || typeof restaurantId !== 'string' || typeof itemId !== 'string') {
      res.status(400).json({ error: 'phone, restaurantId and itemId are required' });
      return;
    }

    const now = Date.now();
    const session = await store.get(phone, now);
    if (session.state !== 'IDLE') {
      res.status(409).json({ error: 'finish or cancel the current conversation step before editing the cart' });
      return;
    }

    const nextCart = session.cart.filter((l) => !(l.restaurantId === restaurantId && l.itemId === itemId));
    const nextSession: Session = { ...session, cart: nextCart, updatedAt: now };
    await store.set(nextSession);
    res.json(cartPayload(nextSession));
  });

  router.post('/cart/clear', async (req: Request, res: Response) => {
    const { phone } = (req.body ?? {}) as { phone?: unknown };
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone is required' });
      return;
    }

    const now = Date.now();
    const session = await store.get(phone, now);
    if (session.state !== 'IDLE') {
      res.status(409).json({ error: 'finish or cancel the current conversation step before editing the cart' });
      return;
    }

    const nextSession: Session = { ...session, cart: [], updatedAt: now };
    await store.set(nextSession);
    res.json(cartPayload(nextSession));
  });

  router.get('/promos', (_req: Request, res: Response) => {
    res.json({ promos: getAllPromos() });
  });

  router.get('/catalog', (req: Request, res: Response) => {
    const query = req.query['q'];
    if (typeof query === 'string' && query.trim()) {
      res.json({ entries: searchCatalog(query) });
      return;
    }
    res.json({ restaurants: getAllRestaurants() });
  });

  router.get('/orders/current', async (req: Request, res: Response) => {
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }

    const session = await store.get(phone, Date.now());
    if (!session.currentOrder) {
      res.json({ order: null });
      return;
    }

    const status = statusAt(session.currentOrder.placedAt, Date.now());
    res.json({ order: { id: session.currentOrder.id, status, partner: partnerFor(session.currentOrder.id, status) } });
  });

  /**
   * "Report an issue" is order-linked, not a free-standing ticket - an
   * order id must actually belong to this phone's own order history
   * (current or past) before a complaint can be filed against it.
   */
  router.get('/orders', async (req: Request, res: Response) => {
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }
    const session = await store.get(phone, Date.now());
    const orders = session.pastOrders.map((o) => ({
      id: o.id,
      cart: o.cart,
      bill: o.bill,
      address: o.address,
      paymentMethod: o.paymentMethod,
      placedAt: o.placedAt,
      status: o.cancelledAt !== null ? 'CANCELLED' : statusAt(o.placedAt, Date.now()),
      partner: o.cancelledAt === null ? partnerFor(o.id, statusAt(o.placedAt, Date.now())) : null,
    }));
    res.json({ orders });
  });

  router.post('/complaints', async (req: Request, res: Response) => {
    const { phone, orderId, category, description } = (req.body ?? {}) as {
      phone?: unknown;
      orderId?: unknown;
      category?: unknown;
      description?: unknown;
    };
    if (typeof phone !== 'string' || !phone.trim() || typeof orderId !== 'string' || !orderId.trim()) {
      res.status(400).json({ error: 'phone and orderId are required' });
      return;
    }
    if (typeof category !== 'string' || !COMPLAINT_CATEGORIES.includes(category as ComplaintCategory)) {
      res.status(400).json({ error: `category must be one of ${COMPLAINT_CATEGORIES.join(', ')}` });
      return;
    }

    const session = await store.get(phone, Date.now());
    const ownsOrder = session.pastOrders.some((o) => o.id === orderId);
    if (!ownsOrder) {
      res.status(404).json({ error: 'no matching order for this phone' });
      return;
    }

    const complaint = await createComplaint({
      phone,
      orderId,
      category: category as ComplaintCategory,
      description: typeof description === 'string' ? description : null,
    });
    res.status(201).json({ complaint });
  });

  router.get('/complaints', async (req: Request, res: Response) => {
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }
    const complaints = await getComplaintsForUser(phone);
    res.json({ complaints });
  });

  router.post('/message', async (req: Request, res: Response) => {
    const { phone, text } = (req.body ?? {}) as { phone?: unknown; text?: unknown };
    if (typeof phone !== 'string' || !phone.trim() || typeof text !== 'string') {
      res.status(400).json({ error: 'phone and text are required' });
      return;
    }

    try {
      const result = await processMessage(store, phone, text);
      res.json(result);
    } catch (err) {
      log.error('failed to process message', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/orders/:orderId/stream', async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }

    const session = await store.get(phone, Date.now());
    const order = session.currentOrder;
    if (!order || order.id !== orderId) {
      res.status(404).json({ error: 'no matching order for this phone' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendUpdate = () => {
      const status = statusAt(order.placedAt, Date.now());
      res.write(`data: ${JSON.stringify({ status, partner: partnerFor(order.id, status) })}\n\n`);
      if (status === 'DELIVERED') {
        clearInterval(timer);
        res.end();
      }
    };

    const timer = setInterval(sendUpdate, STREAM_INTERVAL_MS);
    sendUpdate();
    req.on('close', () => {
      clearInterval(timer);
      log.info(`stream closed for ${orderId}`);
    });
  });

  return router;
}
