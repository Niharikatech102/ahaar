import { getUsualOrder, recommend } from '../domain/recommender.js';
import { applicablePromos, bestApplicablePromo, evaluatePromo, getPromoByCode } from '../domain/promos.js';
import { computeBill, generateOrderId, type CartItem, type Order } from '../domain/order.js';
import { statusAt } from '../domain/delivery.js';
import { getItemById, getRestaurantById } from '../domain/catalog.js';
import type { PastOrder, Recommendation, UserPreferences, UserProfile } from '../domain/types.js';
import {
  explicitlyRequestsNonVeg,
  isBestDiscountRequest,
  isTotalRequest,
  parseAddCommand,
  parseGlobalCommand,
  parseQuantity,
  parseQuantityUpdateCommand,
  parseQuery,
  parseRating,
  parseRemoveCommand,
  parseSelection,
  isWord,
  type ParsedQuery,
} from './intent.js';
import * as msg from './messages.js';
import { resetToIdle, type Session } from './session.js';

export interface Ctx {
  profile: UserProfile;
  now: number;
  /** Overridable for deterministic tests; defaults to a timestamp+random id. */
  orderIdFactory?: () => string;
  /** Pre-parsed query (e.g. from the LLM intent layer) to use instead of the regex parser below. */
  parsedQueryOverride?: ParsedQuery;
}

export interface QuickReply {
  label: string;
  /** The exact text to send when tapped - matches what this state machine already accepts as typed input. */
  value: string;
}

export interface StepResult {
  session: Session;
  replies: string[];
  /**
   * Tappable options for whichever reply is last in `replies`, when that
   * reply is waiting on a fixed-choice answer. Built by the same handler
   * that crafts the prompt text, so the buttons can never drift out of sync
   * with what the text actually offers.
   */
  quickReplies?: QuickReply[];
  /** Set only on the turn a numeric star rating was just submitted - engine.ts persists it, one PastOrder per cart line that was rated. */
  ratingsToRecord?: PastOrder[];
  /** The batch of recommendation cards freshly shown this turn (a search or "give me more"), for a UI that wants structured data instead of parsing the reply text. Not the cumulative list - just what's new right now. */
  recommendations?: Recommendation[];
}

/**
 * Falls back to the user's saved dietary preference when the message itself
 * doesn't ask for veg - a saved "veg"/"vegan" preference should hold on
 * every future search, not just the one where it happened to be typed out.
 * An explicit "non-veg" in this message still wins, since a saved
 * preference shouldn't silently filter out what was just asked for.
 */
export function resolveVegOnly(queryVegOnly: boolean, rawText: string, prefs: UserPreferences): boolean {
  if (explicitlyRequestsNonVeg(rawText)) return false;
  if (queryVegOnly) return true;
  return prefs.dietary === 'veg' || prefs.dietary === 'vegan';
}

/** Falls back to the user's saved budget when this message doesn't name its own. */
export function resolveMaxPrice(queryMaxPrice: number | undefined, prefs: UserPreferences): number | undefined {
  return queryMaxPrice ?? prefs.budgetMax ?? undefined;
}

function defaultAddressLine(profile: UserProfile): string | null {
  return profile.addresses.find((a) => a.isDefault)?.line ?? profile.addresses[0]?.line ?? null;
}

function confirmQuickReplies(): QuickReply[] {
  return [
    { label: 'Yes, place order', value: 'CONFIRM' },
    { label: 'No, cancel', value: 'CANCEL' },
  ];
}

/**
 * Sentinel `value` meaning "focus the composer, don't send anything" -
 * for a button offering free-text entry (a new delivery address) rather
 * than a fixed reply. simulator.js's frontend recognizes this exact string
 * and special-cases it instead of sending it as a message; twilio.ts never
 * sees it, since it ignores quickReplies entirely.
 */
export const FOCUS_INPUT_ACTION = '__focus_input__';

function addressQuickReplies(defaultLine: string | null): QuickReply[] | undefined {
  if (!defaultLine) return undefined;
  return [
    { label: 'Yes, deliver here', value: 'YES' },
    { label: 'Use a different address', value: FOCUS_INPUT_ACTION },
  ];
}

function promoQuickReplies(suggestion: { promo: { code: string } } | null): QuickReply[] {
  const seeAll: QuickReply = { label: 'See all offers', value: 'CODES' };
  const skip: QuickReply = { label: 'Skip', value: 'SKIP' };
  return suggestion
    ? [{ label: `Apply ${suggestion.promo.code}`, value: 'APPLY' }, seeAll, skip]
    : [seeAll, skip];
}

function ratingQuickReplies(): QuickReply[] {
  return [
    { label: '⭐ 1', value: '1' },
    { label: '⭐⭐ 2', value: '2' },
    { label: '⭐⭐⭐ 3', value: '3' },
    { label: '⭐⭐⭐⭐ 4', value: '4' },
    { label: '⭐⭐⭐⭐⭐ 5', value: '5' },
    { label: 'Skip', value: 'SKIP' },
  ];
}

/** One cart line built from a fully-configured selection (dish + quantity). */
function cartLineFromSelection(selected: NonNullable<Session['selected']>, quantity: number): CartItem {
  return {
    restaurantId: selected.restaurant.id,
    restaurantName: selected.restaurant.name,
    itemId: selected.item.id,
    itemName: selected.item.name,
    unitPrice: selected.item.price,
    quantity,
  };
}

/** Adds a line to the cart, merging into an existing line for the same dish rather than duplicating it. */
export function addLineToCart(cart: CartItem[], line: CartItem): CartItem[] {
  const idx = cart.findIndex((l) => l.restaurantId === line.restaurantId && l.itemId === line.itemId);
  if (idx === -1) return [...cart, line];
  const merged = [...cart];
  merged[idx] = { ...merged[idx]!, quantity: merged[idx]!.quantity + line.quantity };
  return merged;
}

/** Finds the cart line whose name best matches a free-text fragment (e.g. "coffee" -> "Filter Coffee"). */
function findCartLineIndex(cart: CartItem[], nameQuery: string): number {
  const q = nameQuery.trim().toLowerCase();
  return cart.findIndex((l) => l.itemName.toLowerCase().includes(q) || q.includes(l.itemName.toLowerCase()));
}

/**
 * Aggregate restaurant/cuisine context for promo eligibility across every
 * line in a (possibly multi-restaurant) cart. `restaurantId` is only set
 * when the whole cart is from one restaurant, so a restaurant-scoped promo
 * correctly never matches a mixed cart; `cuisines` is the union across
 * every restaurant represented, so a cuisine-scoped promo matches if any
 * line qualifies.
 */
function cartOrderContext(cart: CartItem[]): { restaurantId: string; cuisines: string[] } {
  const restaurantIds = [...new Set(cart.map((l) => l.restaurantId))];
  const cuisines = [...new Set(restaurantIds.flatMap((id) => getRestaurantById(id)?.cuisines ?? []))];
  return { restaurantId: restaurantIds.length === 1 ? restaurantIds[0]! : '', cuisines };
}

/** Slowest ETA across every restaurant represented in the cart - delivery waits for the slowest item. */
function cartEtaMinutes(cart: CartItem[]): number {
  const restaurantIds = [...new Set(cart.map((l) => l.restaurantId))];
  const etas = restaurantIds.map((id) => getRestaurantById(id)?.etaMinutes ?? 30);
  return Math.max(...etas, 0);
}

function handleIdle(session: Session, text: string, ctx: Ctx): StepResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { session, replies: [msg.welcomeMessage()] };
  }

  const query = ctx.parsedQueryOverride ?? parseQuery(trimmed);
  const recs = recommend(query.raw, ctx.profile.orderHistory, {
    vegOnly: resolveVegOnly(query.vegOnly, trimmed, ctx.profile.preferences),
    maxPrice: resolveMaxPrice(query.maxPrice, ctx.profile.preferences),
    preferences: ctx.profile.preferences,
  });

  if (recs.length === 0) {
    return { session, replies: [msg.noResultsMessage(query.raw)] };
  }

  const next: Session = {
    ...session,
    state: 'AWAITING_SELECTION',
    shownRecommendations: recs,
    lastQuery: query.raw,
    updatedAt: ctx.now,
  };
  return { session: next, replies: [msg.recommendationsMessage(recs)], recommendations: recs };
}

/**
 * "Give me more" / "show more" - re-runs the same search that produced the
 * current recommendations, excluding every dish already shown, and appends
 * the new batch so replying "4" still resolves correctly against the
 * cumulative list.
 */
function handleMoreRecommendations(session: Session, ctx: Ctx): StepResult {
  if (session.state !== 'AWAITING_SELECTION' || !session.lastQuery) {
    return { session, replies: [msg.noMoreRecommendationsContextMessage()] };
  }

  const alreadyShown = session.shownRecommendations.map((r) => r.entry.item.id);
  const more = recommend(session.lastQuery, ctx.profile.orderHistory, {
    vegOnly: resolveVegOnly(false, session.lastQuery, ctx.profile.preferences),
    maxPrice: resolveMaxPrice(undefined, ctx.profile.preferences),
    preferences: ctx.profile.preferences,
    excludeItemIds: alreadyShown,
  });

  if (more.length === 0) {
    return { session, replies: [msg.noMoreRecommendationsMessage()] };
  }

  const next: Session = {
    ...session,
    shownRecommendations: [...session.shownRecommendations, ...more],
    updatedAt: ctx.now,
  };
  return {
    session: next,
    replies: [msg.recommendationsMessage(more, alreadyShown.length)],
    recommendations: more,
  };
}

function handleAwaitingSelection(session: Session, text: string, ctx: Ctx): StepResult {
  const index = parseSelection(text);

  if (index === null) {
    // Not a number - treat it as a fresh search rather than erroring out.
    return handleIdle({ ...session, state: 'IDLE' }, text, ctx);
  }

  const rec = session.shownRecommendations[index - 1];
  if (!rec) {
    return { session, replies: [msg.invalidSelectionMessage(session.shownRecommendations.length)] };
  }

  const next: Session = {
    ...session,
    state: 'AWAITING_QUANTITY',
    selected: rec.entry,
    updatedAt: ctx.now,
  };
  return {
    session: next,
    replies: [msg.selectionConfirmMessage(rec.entry.item.name, rec.entry.restaurant.name)],
  };
}

function handleAwaitingQuantity(session: Session, text: string, ctx: Ctx): StepResult {
  const qty = parseQuantity(text);
  if (qty === null) {
    return { session, replies: [msg.invalidQuantityMessage()] };
  }
  if (!session.selected) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const line = cartLineFromSelection(session.selected, qty);
  const nextCart = addLineToCart(session.cart, line);
  const next: Session = {
    ...session,
    state: 'IDLE',
    selected: null,
    quantity: null,
    cart: nextCart,
    updatedAt: ctx.now,
  };
  return { session: next, replies: [msg.itemAddedMessage(line, nextCart)] };
}

function handleAddCommand(session: Session, query: string, ctx: Ctx): StepResult {
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cartBusyMessage()] };
  }

  const recs = recommend(query, ctx.profile.orderHistory, {
    vegOnly: resolveVegOnly(false, query, ctx.profile.preferences),
    maxPrice: resolveMaxPrice(undefined, ctx.profile.preferences),
    preferences: ctx.profile.preferences,
  });
  if (recs.length === 0) {
    return { session, replies: [msg.addItemNotFoundMessage(query)] };
  }

  const top = recs[0]!.entry;
  const line: CartItem = {
    restaurantId: top.restaurant.id,
    restaurantName: top.restaurant.name,
    itemId: top.item.id,
    itemName: top.item.name,
    unitPrice: top.item.price,
    quantity: 1,
  };
  const nextCart = addLineToCart(session.cart, line);
  const next: Session = { ...session, cart: nextCart, updatedAt: ctx.now };
  return { session: next, replies: [msg.itemAddedMessage(line, nextCart)] };
}

function handleRemoveCommand(session: Session, query: string, ctx: Ctx): StepResult {
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cartBusyMessage()] };
  }

  const idx = findCartLineIndex(session.cart, query);
  if (idx === -1) {
    return { session, replies: [msg.removeItemNotFoundMessage(query)] };
  }

  const removed = session.cart[idx]!;
  const nextCart = session.cart.filter((_, i) => i !== idx);
  const next: Session = { ...session, cart: nextCart, updatedAt: ctx.now };
  return { session: next, replies: [msg.itemRemovedMessage(removed, nextCart)] };
}

function handleQuantityUpdateCommand(session: Session, target: string, quantity: number, ctx: Ctx): StepResult {
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cartBusyMessage()] };
  }
  if (session.cart.length === 0) {
    return { session, replies: [msg.emptyCartMessage()] };
  }

  const idx =
    target === 'that' || target === 'it' || target === ''
      ? session.cart.length - 1
      : findCartLineIndex(session.cart, target);

  if (idx === -1) {
    return { session, replies: [msg.removeItemNotFoundMessage(target)] };
  }

  const nextCart = [...session.cart];
  nextCart[idx] = { ...nextCart[idx]!, quantity };
  const next: Session = { ...session, cart: nextCart, updatedAt: ctx.now };
  return { session: next, replies: [msg.quantityUpdatedMessage(nextCart[idx]!, nextCart)] };
}

function handleViewCart(session: Session): StepResult {
  return { session, replies: [msg.cartMessage(session.cart)] };
}

/** "What's my total?" - works in any state, using whatever discount has already been applied so far. */
function handleTotal(session: Session): StepResult {
  if (session.cart.length === 0) {
    return { session, replies: [msg.emptyCartMessage()] };
  }
  const bill = computeBill(session.cart, session.appliedDiscount, session.appliedPromoCode);
  return { session, replies: [msg.totalMessage(session.cart, bill)] };
}

function handleClearCart(session: Session, ctx: Ctx): StepResult {
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cartBusyMessage()] };
  }
  if (session.cart.length === 0) {
    return { session, replies: [msg.emptyCartMessage()] };
  }
  const next: Session = { ...session, cart: [], updatedAt: ctx.now };
  return { session: next, replies: [msg.cartClearedMessage()] };
}

function handleCheckout(session: Session, ctx: Ctx): StepResult {
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cartBusyMessage()] };
  }
  if (session.cart.length === 0) {
    return { session, replies: [msg.emptyCartMessage()] };
  }

  const next: Session = { ...session, state: 'AWAITING_ADDRESS', updatedAt: ctx.now };
  const defaultLine = defaultAddressLine(ctx.profile);
  return {
    session: next,
    replies: [msg.addressPromptMessage(defaultLine)],
    quickReplies: addressQuickReplies(defaultLine),
  };
}

function handleAwaitingAddress(session: Session, text: string, ctx: Ctx): StepResult {
  const defaultLine = defaultAddressLine(ctx.profile);
  const address = isWord(text, 'YES') && defaultLine ? defaultLine : text.trim();

  if (!address) {
    return {
      session,
      replies: [msg.addressPromptMessage(defaultLine)],
      quickReplies: addressQuickReplies(defaultLine),
    };
  }

  if (session.cart.length === 0) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const { restaurantId, cuisines } = cartOrderContext(session.cart);
  const subtotal = session.cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const suggestion = bestApplicablePromo({
    subtotal,
    restaurantId,
    cuisines,
    isFirstOrder: ctx.profile.orderHistory.length === 0,
    timesUsedByUser: 0,
  });

  const next: Session = {
    ...session,
    state: 'AWAITING_PROMO',
    address,
    updatedAt: ctx.now,
  };
  return {
    session: next,
    replies: [msg.promoPromptMessage(suggestion ? { promo: suggestion.promo, discount: suggestion.result.discount } : null)],
    quickReplies: promoQuickReplies(suggestion),
  };
}

function paymentQuickReplies(): QuickReply[] {
  return [
    { label: 'Cash on Delivery', value: 'COD' },
    { label: 'UPI', value: 'UPI' },
  ];
}

/** Promo resolution is done; ask how they want to pay before showing the final bill. */
function moveToPayment(session: Session, ctx: Ctx, code: string | null, discount: number): StepResult {
  if (session.cart.length === 0 || !session.address) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const next: Session = {
    ...session,
    state: 'AWAITING_PAYMENT',
    appliedPromoCode: code,
    appliedDiscount: discount,
    updatedAt: ctx.now,
  };
  return {
    session: next,
    replies: [msg.paymentMethodPromptMessage()],
    quickReplies: paymentQuickReplies(),
  };
}

function handleAwaitingPayment(session: Session, text: string, ctx: Ctx): StepResult {
  const trimmed = text.trim();
  const method = isWord(trimmed, 'COD') ? 'COD' : isWord(trimmed, 'UPI') ? 'UPI' : null;
  if (!method) {
    return { session, replies: [msg.invalidPaymentMethodMessage()], quickReplies: paymentQuickReplies() };
  }
  if (session.cart.length === 0 || !session.address) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const bill = computeBill(session.cart, session.appliedDiscount, session.appliedPromoCode);
  const next: Session = {
    ...session,
    state: 'AWAITING_CONFIRM',
    paymentMethod: method,
    updatedAt: ctx.now,
  };
  return {
    session: next,
    replies: [msg.billMessage(session.cart, bill, session.address, method)],
    quickReplies: confirmQuickReplies(),
  };
}

function handleAwaitingPromo(session: Session, text: string, ctx: Ctx): StepResult {
  const trimmed = text.trim();
  if (isWord(trimmed, 'SKIP')) {
    return moveToPayment(session, ctx, null, 0);
  }

  if (session.cart.length === 0) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const { restaurantId, cuisines } = cartOrderContext(session.cart);
  const subtotal = session.cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const orderContext = {
    subtotal,
    restaurantId,
    cuisines,
    isFirstOrder: ctx.profile.orderHistory.length === 0,
    timesUsedByUser: 0,
  };

  if (isWord(trimmed, 'CODES')) {
    const all = applicablePromos(orderContext);
    return {
      session,
      replies: [msg.allPromosMessage(all.map((p) => ({ promo: p.promo, discount: p.result.discount })))],
      quickReplies: promoQuickReplies(all[0] ?? null),
    };
  }

  const wantsBestDiscount = isWord(trimmed, 'APPLY') || isBestDiscountRequest(trimmed);

  if (wantsBestDiscount) {
    const suggestion = bestApplicablePromo(orderContext);
    if (!suggestion) {
      return { session, replies: [msg.promoPromptMessage(null)], quickReplies: promoQuickReplies(null) };
    }
    const replies = [msg.promoAppliedMessage(suggestion.promo.code, suggestion.result.discount)];
    const { session: nextSession, replies: paymentReplies, quickReplies } = moveToPayment(
      session,
      ctx,
      suggestion.promo.code,
      suggestion.result.discount,
    );
    return { session: nextSession, replies: [...replies, ...paymentReplies], quickReplies };
  }

  const promo = getPromoByCode(trimmed);
  if (!promo) {
    return {
      session,
      replies: [msg.noPromoInvalidCodeMessage(trimmed)],
      quickReplies: promoQuickReplies(null),
    };
  }

  const result = evaluatePromo(promo, orderContext);
  if (!result.eligible) {
    return {
      session,
      replies: [msg.promoRejectedMessage(result.reason ?? 'not eligible')],
      quickReplies: promoQuickReplies(null),
    };
  }

  const replies = [msg.promoAppliedMessage(promo.code, result.discount)];
  const { session: nextSession, replies: paymentReplies, quickReplies } = moveToPayment(
    session,
    ctx,
    promo.code,
    result.discount,
  );
  return { session: nextSession, replies: [...replies, ...paymentReplies], quickReplies };
}

function handleAwaitingConfirm(session: Session, text: string, ctx: Ctx): StepResult {
  if (!isWord(text, 'CONFIRM')) {
    return {
      session,
      replies: [msg.invalidConfirmMessage()],
      quickReplies: confirmQuickReplies(),
    };
  }

  if (session.cart.length === 0 || !session.address || !session.paymentMethod) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const bill = computeBill(session.cart, session.appliedDiscount, session.appliedPromoCode);
  const idFactory = ctx.orderIdFactory ?? (() => generateOrderId(ctx.now));
  const order: Order = {
    id: idFactory(),
    phone: session.phone,
    cart: session.cart,
    bill,
    address: session.address,
    paymentMethod: session.paymentMethod,
    placedAt: ctx.now,
    restaurantEtaMinutes: cartEtaMinutes(session.cart),
  };

  const next = resetToIdle(
    {
      ...session,
      cart: [],
      currentOrder: order,
      pastOrders: [{ ...order, cancelledAt: null }, ...session.pastOrders],
      pendingRatingOrderId: null,
      ratingHandledForOrderId: null,
    },
    ctx.now,
  );
  return { session: next, replies: [msg.orderPlacedMessage(order)] };
}

function handleReorder(session: Session, ctx: Ctx): StepResult {
  if (!session.currentOrder) {
    return { session, replies: [msg.noPreviousOrderMessage()] };
  }
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cannotReorderMidFlowMessage()] };
  }

  const skippedNames: string[] = [];
  let nextCart = session.cart;
  for (const line of session.currentOrder.cart) {
    const restaurant = getRestaurantById(line.restaurantId);
    const item = restaurant && getItemById(restaurant.id, line.itemId);
    if (!restaurant || !item) {
      skippedNames.push(line.itemName);
      continue;
    }
    nextCart = addLineToCart(nextCart, { ...line });
  }

  if (nextCart.length === session.cart.length) {
    return { session, replies: [msg.reorderNothingAvailableMessage()] };
  }

  const addedCount = session.currentOrder.cart.length - skippedNames.length;
  const next: Session = { ...session, cart: nextCart, updatedAt: ctx.now };
  return { session: next, replies: [msg.reorderAddedMessage(nextCart, addedCount, skippedNames)] };
}

/**
 * "My usual" - the user's most-frequently-ordered dish, computed from real
 * order history (not simply their last order, which REORDER already covers).
 */
function handleMyUsual(session: Session, ctx: Ctx): StepResult {
  if (session.state !== 'IDLE') {
    return { session, replies: [msg.cartBusyMessage()] };
  }

  const usual = getUsualOrder(ctx.profile.orderHistory);
  if (!usual) {
    return { session, replies: [msg.noUsualOrderMessage()] };
  }

  const restaurant = getRestaurantById(usual.restaurantId);
  const item = restaurant && getItemById(restaurant.id, usual.itemId);
  if (!restaurant || !item) {
    return { session, replies: [msg.reorderNothingAvailableMessage()] };
  }

  const line: CartItem = {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    itemId: item.id,
    itemName: item.name,
    unitPrice: item.price,
    quantity: 1,
  };
  const nextCart = addLineToCart(session.cart, line);
  const next: Session = { ...session, cart: nextCart, updatedAt: ctx.now };
  return { session: next, replies: [msg.usualAddedMessage(line, usual.timesOrdered, nextCart)] };
}

const STATE_HANDLERS: Record<Session['state'], (session: Session, text: string, ctx: Ctx) => StepResult> = {
  IDLE: handleIdle,
  AWAITING_SELECTION: handleAwaitingSelection,
  AWAITING_QUANTITY: handleAwaitingQuantity,
  AWAITING_ADDRESS: handleAwaitingAddress,
  AWAITING_PROMO: handleAwaitingPromo,
  AWAITING_PAYMENT: handleAwaitingPayment,
  AWAITING_CONFIRM: handleAwaitingConfirm,
};

/**
 * Pure conversation reducer: (session, message, context) -> (new session, replies).
 * Global commands (MENU/HELP/STATUS/CANCEL/cart commands/...) short-circuit
 * every state; everything else is dispatched to the handler for the
 * session's current state.
 */
export function handleMessage(session: Session, text: string, ctx: Ctx): StepResult {
  const command = parseGlobalCommand(text);

  if (command === 'HELP') {
    return { session, replies: [msg.helpMessage()] };
  }

  if (command === 'MENU') {
    return { session: resetToIdle(session, ctx.now), replies: [msg.welcomeMessage()] };
  }

  if (command === 'CANCEL') {
    if (session.state !== 'IDLE') {
      return { session: resetToIdle(session, ctx.now), replies: [msg.cancelledMessage()] };
    }
    if (session.currentOrder) {
      if (statusAt(session.currentOrder.placedAt, ctx.now) === 'CONFIRMED') {
        const cancelledId = session.currentOrder.id;
        const next: Session = {
          ...session,
          currentOrder: null,
          pastOrders: session.pastOrders.map((o) =>
            o.id === cancelledId ? { ...o, cancelledAt: ctx.now } : o,
          ),
          pendingRatingOrderId: null,
          ratingHandledForOrderId: null,
        };
        return { session: next, replies: [msg.orderCancelledAfterConfirmMessage(cancelledId)] };
      }
      return { session, replies: [msg.tooLateToCancelMessage()] };
    }
    return { session, replies: [msg.nothingToCancelMessage()] };
  }

  if (command === 'STATUS') {
    if (!session.currentOrder) {
      return { session, replies: [msg.noActiveOrderMessage()] };
    }
    const status = statusAt(session.currentOrder.placedAt, ctx.now);
    const statusReply = msg.statusUpdateMessage(session.currentOrder, status);

    if (status === 'DELIVERED' && session.ratingHandledForOrderId !== session.currentOrder.id) {
      const next: Session = {
        ...session,
        pendingRatingOrderId: session.currentOrder.id,
        ratingHandledForOrderId: session.currentOrder.id,
      };
      return { session: next, replies: [statusReply, msg.ratingPromptMessage()], quickReplies: ratingQuickReplies() };
    }
    return { session, replies: [statusReply] };
  }

  if (command === 'REORDER') {
    return handleReorder(session, ctx);
  }

  if (command === 'MY USUAL' || command === 'USUAL' || command === 'ORDER MY USUAL') {
    return handleMyUsual(session, ctx);
  }

  if (
    command === 'GIVE ME MORE' ||
    command === 'MORE' ||
    command === 'SHOW MORE' ||
    command === 'MORE OPTIONS' ||
    command === 'MORE RECOMMENDATIONS'
  ) {
    return handleMoreRecommendations(session, ctx);
  }

  if (command === 'CART' || command === 'VIEW CART' || command === 'SHOW CART' || command === 'MY CART') {
    return handleViewCart(session);
  }

  if (command === 'CHECKOUT') {
    return handleCheckout(session, ctx);
  }

  if (command === 'CLEAR CART' || command === 'EMPTY CART') {
    return handleClearCart(session, ctx);
  }

  if (isTotalRequest(text)) {
    return handleTotal(session);
  }

  const addQuery = parseAddCommand(text);
  if (addQuery) {
    return handleAddCommand(session, addQuery, ctx);
  }

  const removeQuery = parseRemoveCommand(text);
  if (removeQuery) {
    return handleRemoveCommand(session, removeQuery, ctx);
  }

  const qtyUpdate = parseQuantityUpdateCommand(text);
  if (qtyUpdate) {
    return handleQuantityUpdateCommand(session, qtyUpdate.target, qtyUpdate.quantity, ctx);
  }

  // A reply to a still-open rating prompt - a bare 1-5 or SKIP answers it and
  // stops here; anything else forfeits the one-shot window and falls through
  // to normal handling below instead of hijacking an unrelated message.
  if (session.pendingRatingOrderId && session.currentOrder?.id === session.pendingRatingOrderId && session.state === 'IDLE') {
    const trimmed = text.trim();
    const cleared: Session = { ...session, pendingRatingOrderId: null };

    if (isWord(trimmed, 'SKIP')) {
      return { session: cleared, replies: [msg.ratingSkippedMessage()] };
    }

    const rating = parseRating(trimmed);
    if (rating !== null) {
      const order = session.currentOrder;
      const ratedOrders: PastOrder[] = order.cart.map((line) => {
        const restaurant = getRestaurantById(line.restaurantId);
        return {
          restaurantId: line.restaurantId,
          itemId: line.itemId,
          cuisine: restaurant?.cuisines[0] ?? '',
          daysAgo: 0,
          rating,
        };
      });
      return { session: cleared, replies: [msg.ratingThanksMessage(rating)], ratingsToRecord: ratedOrders };
    }

    return STATE_HANDLERS[cleared.state](cleared, text, ctx);
  }

  return STATE_HANDLERS[session.state](session, text, ctx);
}
