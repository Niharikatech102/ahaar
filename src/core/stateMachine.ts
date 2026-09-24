import { recommend } from '../domain/recommender.js';
import { bestApplicablePromo, evaluatePromo, getPromoByCode } from '../domain/promos.js';
import { computeBill, generateOrderId, type CartItem, type Order } from '../domain/order.js';
import { statusAt } from '../domain/delivery.js';
import type { UserProfile } from '../domain/types.js';
import { parseGlobalCommand, parseQuantity, parseQuery, parseSelection, isWord } from './intent.js';
import * as msg from './messages.js';
import { resetToIdle, type Session } from './session.js';

export interface Ctx {
  profile: UserProfile;
  now: number;
  /** Overridable for deterministic tests; defaults to a timestamp+random id. */
  orderIdFactory?: () => string;
}

export interface StepResult {
  session: Session;
  replies: string[];
}

function defaultAddressLine(profile: UserProfile): string | null {
  return profile.addresses.find((a) => a.isDefault)?.line ?? profile.addresses[0]?.line ?? null;
}

function handleIdle(session: Session, text: string, ctx: Ctx): StepResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { session, replies: [msg.welcomeMessage()] };
  }

  const query = parseQuery(trimmed);
  const recs = recommend(query.raw, ctx.profile.orderHistory, {
    vegOnly: query.vegOnly,
    maxPrice: query.maxPrice,
  });

  if (recs.length === 0) {
    return { session, replies: [msg.noResultsMessage(query.raw)] };
  }

  const next: Session = {
    ...session,
    state: 'AWAITING_SELECTION',
    shownRecommendations: recs,
    updatedAt: ctx.now,
  };
  return { session: next, replies: [msg.recommendationsMessage(recs)] };
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

  const next: Session = {
    ...session,
    state: 'AWAITING_ADDRESS',
    quantity: qty,
    updatedAt: ctx.now,
  };
  return { session: next, replies: [msg.addressPromptMessage(defaultAddressLine(ctx.profile))] };
}

function buildCart(session: Session): CartItem | null {
  if (!session.selected || !session.quantity) return null;
  return {
    restaurantId: session.selected.restaurant.id,
    restaurantName: session.selected.restaurant.name,
    itemId: session.selected.item.id,
    itemName: session.selected.item.name,
    unitPrice: session.selected.item.price,
    quantity: session.quantity,
  };
}

function handleAwaitingAddress(session: Session, text: string, ctx: Ctx): StepResult {
  const defaultLine = defaultAddressLine(ctx.profile);
  const address = isWord(text, 'YES') && defaultLine ? defaultLine : text.trim();

  if (!address) {
    return { session, replies: [msg.addressPromptMessage(defaultLine)] };
  }

  const cart = buildCart(session);
  if (!cart || !session.selected) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const suggestion = bestApplicablePromo({
    subtotal: cart.unitPrice * cart.quantity,
    restaurantId: cart.restaurantId,
    cuisines: session.selected.restaurant.cuisines,
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
  };
}

function moveToConfirm(session: Session, ctx: Ctx, code: string | null, discount: number): StepResult {
  const cart = buildCart(session);
  if (!cart || !session.address) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const bill = computeBill(cart, discount, code);
  const next: Session = {
    ...session,
    state: 'AWAITING_CONFIRM',
    appliedPromoCode: code,
    appliedDiscount: discount,
    updatedAt: ctx.now,
  };
  return { session: next, replies: [msg.billMessage(cart, bill, session.address)] };
}

function handleAwaitingPromo(session: Session, text: string, ctx: Ctx): StepResult {
  const trimmed = text.trim();
  if (isWord(trimmed, 'SKIP')) {
    return moveToConfirm(session, ctx, null, 0);
  }

  const cart = buildCart(session);
  if (!cart || !session.selected) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const orderContext = {
    subtotal: cart.unitPrice * cart.quantity,
    restaurantId: cart.restaurantId,
    cuisines: session.selected.restaurant.cuisines,
    isFirstOrder: ctx.profile.orderHistory.length === 0,
    timesUsedByUser: 0,
  };

  if (isWord(trimmed, 'APPLY')) {
    const suggestion = bestApplicablePromo(orderContext);
    if (!suggestion) {
      return { session, replies: [msg.promoPromptMessage(null)] };
    }
    const replies = [msg.promoAppliedMessage(suggestion.promo.code, suggestion.result.discount)];
    const { session: nextSession, replies: billReplies } = moveToConfirm(
      session,
      ctx,
      suggestion.promo.code,
      suggestion.result.discount,
    );
    return { session: nextSession, replies: [...replies, ...billReplies] };
  }

  const promo = getPromoByCode(trimmed);
  if (!promo) {
    return { session, replies: [msg.noPromoInvalidCodeMessage(trimmed)] };
  }

  const result = evaluatePromo(promo, orderContext);
  if (!result.eligible) {
    return { session, replies: [msg.promoRejectedMessage(result.reason ?? 'not eligible')] };
  }

  const replies = [msg.promoAppliedMessage(promo.code, result.discount)];
  const { session: nextSession, replies: billReplies } = moveToConfirm(session, ctx, promo.code, result.discount);
  return { session: nextSession, replies: [...replies, ...billReplies] };
}

function handleAwaitingConfirm(session: Session, text: string, ctx: Ctx): StepResult {
  if (!isWord(text, 'CONFIRM')) {
    return { session, replies: [msg.invalidConfirmMessage()] };
  }

  const cart = buildCart(session);
  if (!cart || !session.address || !session.selected) {
    return { session: resetToIdle(session, ctx.now), replies: [msg.fallbackMessage()] };
  }

  const bill = computeBill(cart, session.appliedDiscount, session.appliedPromoCode);
  const idFactory = ctx.orderIdFactory ?? (() => generateOrderId(ctx.now));
  const order: Order = {
    id: idFactory(),
    phone: session.phone,
    cart,
    bill,
    address: session.address,
    placedAt: ctx.now,
    restaurantEtaMinutes: session.selected.restaurant.etaMinutes,
  };

  const next = resetToIdle({ ...session, currentOrder: order }, ctx.now);
  return { session: next, replies: [msg.orderPlacedMessage(order)] };
}

const STATE_HANDLERS: Record<Session['state'], (session: Session, text: string, ctx: Ctx) => StepResult> = {
  IDLE: handleIdle,
  AWAITING_SELECTION: handleAwaitingSelection,
  AWAITING_QUANTITY: handleAwaitingQuantity,
  AWAITING_ADDRESS: handleAwaitingAddress,
  AWAITING_PROMO: handleAwaitingPromo,
  AWAITING_CONFIRM: handleAwaitingConfirm,
};

/**
 * Pure conversation reducer: (session, message, context) -> (new session, replies).
 * Global commands (MENU/HELP/STATUS/CANCEL) short-circuit every state; everything
 * else is dispatched to the handler for the session's current state.
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
    if (session.state === 'IDLE') {
      return { session, replies: [msg.nothingToCancelMessage()] };
    }
    return { session: resetToIdle(session, ctx.now), replies: [msg.cancelledMessage()] };
  }

  if (command === 'STATUS') {
    if (!session.currentOrder) {
      return { session, replies: [msg.noActiveOrderMessage()] };
    }
    const status = statusAt(session.currentOrder.placedAt, ctx.now);
    return { session, replies: [msg.statusUpdateMessage(session.currentOrder, status)] };
  }

  return STATE_HANDLERS[session.state](session, text, ctx);
}
