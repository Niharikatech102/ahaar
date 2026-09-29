import type { Bill, CartItem, Order, OrderStatus } from '../domain/order.js';
import type { Promo } from '../domain/types.js';
import type { Recommendation } from '../domain/types.js';
import { deliveryPartnerFor, isPartnerAssigned, statusMessage } from '../domain/delivery.js';

const HELP_TEXT = [
  '*How this works*',
  'Type a dish, e.g. "Veg Biryani", and I will suggest three highly-rated options. Or just say *"add pizza"* to add it straight to your cart.',
  '',
  'Anytime, you can type:',
  '*ADD <dish>* — add a dish straight to your cart',
  '*REMOVE <dish>* — take a dish out of your cart',
  '*MAKE <dish> <qty>* — change a cart item\'s quantity, e.g. "make coffee two"',
  '*CART* — see what\'s in your cart',
  '*MY TOTAL* — see your running total, including any discount applied so far',
  '*CHECKOUT* — pay for what\'s in your cart',
  '*CLEAR CART* — empty your cart',
  '*MENU* — start a fresh search',
  '*STATUS* — check your current order',
  '*REORDER* — add your whole last order back to your cart',
  '*MY USUAL* — add your most-frequently-ordered dish to your cart',
  '*BEST DISCOUNT* — apply the biggest promo you\'re eligible for (while choosing a promo)',
  '*CANCEL* — abort what you are doing',
  '*HELP* — show this message',
].join('\n');

export function welcomeMessage(): string {
  return [
    "Hi! I'm your food ordering assistant.",
    'Tell me what you are craving, e.g. "Veg Biryani" or "Paneer under 250".',
  ].join('\n');
}

export function helpMessage(): string {
  return HELP_TEXT;
}

export function cancelledMessage(): string {
  return "No problem, cancelled. Type a dish whenever you're ready to order.";
}

export function nothingToCancelMessage(): string {
  return "You're not in the middle of an order. Type a dish to get started.";
}

export function noResultsMessage(query: string): string {
  return [
    `I couldn't find a 4-star-or-above match for "${query}".`,
    'Try a different dish, or drop any budget/veg filters you mentioned.',
  ].join('\n');
}

/** `startIndex` lets "give me more" continue the numbering (4, 5, 6...) instead of restarting at 1. */
export function recommendationsMessage(recs: Recommendation[], startIndex = 0): string {
  const lines = recs.map((r, i) => {
    const { entry } = r;
    const vegTag = entry.item.veg ? '🟢' : '🔴';
    return [
      `[REC_START]`,
      entry.item.image ? `[IMG:${entry.item.image}]` : '',
      `[CONTENT_START]`,
      `*${startIndex + i + 1}. ${entry.item.name}* ${vegTag}`,
      `${entry.restaurant.name} · ₹${entry.item.price}`,
      r.reason,
      `[CONTENT_END]`,
      `[REC_END]`
    ].filter(Boolean).join('\n');
  });

  const first = startIndex + 1;
  const last = startIndex + recs.length;
  return [
    startIndex === 0 ? `Here are my top ${recs.length} picks:` : `Here are ${recs.length} more:`,
    '',
    lines.join('\n\n'),
    '',
    `Reply *${first}*${last > first ? `-*${last}*` : ''} to choose, type *GIVE ME MORE* for other options, or type another dish to search again.`,
  ].join('\n');
}

export function noMoreRecommendationsMessage(): string {
  return "That's everything I've got matching that search — try a different dish, or drop a filter.";
}

export function noMoreRecommendationsContextMessage(): string {
  return 'Search for a dish first, then I can show you more options for it.';
}

export function invalidSelectionMessage(count: number): string {
  return `Please reply with a number from 1 to ${count} — or type a new dish to search again.`;
}

export function selectionConfirmMessage(itemName: string, restaurantName: string): string {
  return `Great choice — *${itemName}* from ${restaurantName}. How many would you like?`;
}

export function invalidQuantityMessage(): string {
  return 'Please reply with a quantity between 1 and 10.';
}

export function addressPromptMessage(defaultAddressLine: string | null): string {
  if (defaultAddressLine) {
    return [
      `Deliver to: ${defaultAddressLine}?`,
      'Reply *YES* to confirm, or type a different address.',
    ].join('\n');
  }
  return "What's the delivery address for this order?";
}

export function promoPromptMessage(
  suggestion: { promo: Promo; discount: number } | null,
): string {
  if (suggestion) {
    return [
      `You're eligible for *${suggestion.promo.code}* — ${suggestion.promo.description} (saves ₹${suggestion.discount}).`,
      'Reply *APPLY* to use it, type a different code, reply *CODES* to see all offers, or *SKIP*.',
    ].join('\n');
  }
  return 'Have a promo code? Type it now, reply *CODES* to see all offers, or reply *SKIP*.';
}

export function promoAppliedMessage(code: string, discount: number): string {
  return `Applied *${code}* — you saved ₹${discount}.`;
}

export function promoRejectedMessage(reason: string): string {
  return [
    `That code isn't valid: ${reason}.`,
    'Try a different code, or reply *SKIP*.',
  ].join('\n');
}

export function noPromoInvalidCodeMessage(code: string): string {
  return [`"${code}" isn't a code I recognise.`, 'Try a different code, or reply *SKIP*.'].join('\n');
}

export function allPromosMessage(promos: { promo: Promo; discount: number }[]): string {
  if (promos.length === 0) {
    return [
      'No promo codes are eligible on this order right now.',
      'Reply *SKIP* to continue without one.',
    ].join('\n');
  }
  const lines = promos.map((p) => `*${p.promo.code}* — ${p.promo.description} (saves ₹${p.discount})`);
  return [
    '*Offers available on this order:*',
    '',
    lines.join('\n'),
    '',
    'Type a code to apply it, or reply *SKIP*.',
  ].join('\n');
}

/** Unique restaurant names represented in a cart, in first-seen order. */
function restaurantNames(cart: CartItem[]): string[] {
  return [...new Set(cart.map((line) => line.restaurantName))];
}

function cartLineDescriptions(cart: CartItem[]): string[] {
  return cart.map((line) => `${line.itemName} x${line.quantity} — ₹${line.unitPrice * line.quantity}`);
}

function billLines(bill: Bill): string[] {
  const lines: string[] = [];
  if (bill.discount > 0) {
    lines.push(`Discount${bill.appliedPromoCode ? ` (${bill.appliedPromoCode})` : ''}: -₹${bill.discount}`);
  }
  lines.push(`Delivery fee: ₹${bill.deliveryFee}`);
  lines.push(`GST: ₹${bill.gst}`);
  lines.push(`*Total: ₹${bill.total}*`);
  return lines;
}

const PAYMENT_METHOD_LABEL: Record<'COD' | 'UPI', string> = {
  COD: 'Cash on Delivery',
  UPI: 'UPI',
};

export function paymentMethodPromptMessage(): string {
  return 'How would you like to pay? Reply *COD* for Cash on Delivery, or *UPI*.';
}

export function invalidPaymentMethodMessage(): string {
  return 'Reply *COD* for Cash on Delivery, or *UPI*.';
}

export function billMessage(cart: CartItem[], bill: Bill, address: string, paymentMethod: 'COD' | 'UPI'): string {
  return [
    '*Order summary*',
    restaurantNames(cart).join(' + '),
    '',
    ...cartLineDescriptions(cart),
    `Subtotal: ₹${bill.subtotal}`,
    ...billLines(bill),
    '',
    `Deliver to: ${address}`,
    `Payment: ${PAYMENT_METHOD_LABEL[paymentMethod]}`,
    '',
    'Reply *CONFIRM* to place the order, or *CANCEL* to abort.',
  ].join('\n');
}

export function emptyCartMessage(): string {
  return "Your cart is empty. Tell me what you're craving, or type *ADD <dish>* to add something straight to it.";
}

export function cartMessage(cart: CartItem[]): string {
  if (cart.length === 0) return emptyCartMessage();
  const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return [
    `*Your cart (${cart.length} item${cart.length === 1 ? '' : 's'})*`,
    '',
    ...cartLineDescriptions(cart),
    '',
    `Subtotal: ₹${subtotal}`,
    '',
    'Type *CHECKOUT* to pay, *ADD <dish>*/*REMOVE <dish>* to keep editing, or *CLEAR CART* to start over.',
  ].join('\n');
}

export function totalMessage(cart: CartItem[], bill: Bill): string {
  return [
    '*Your total so far*',
    ...cartLineDescriptions(cart),
    `Subtotal: ₹${bill.subtotal}`,
    ...billLines(bill),
  ].join('\n');
}

export function itemAddedMessage(line: CartItem, cart: CartItem[]): string {
  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return [
    `Added *${line.itemName}* x${line.quantity} from ${line.restaurantName} to your cart.`,
    `Cart: ${cart.length} item${cart.length === 1 ? '' : 's'}, ₹${subtotal}.`,
    'Keep adding dishes, or type *CHECKOUT* when you\'re ready.',
  ].join('\n');
}

export function itemRemovedMessage(line: CartItem, cart: CartItem[]): string {
  if (cart.length === 0) {
    return `Removed *${line.itemName}*. Your cart is empty now.`;
  }
  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return `Removed *${line.itemName}*. Cart: ${cart.length} item${cart.length === 1 ? '' : 's'}, ₹${subtotal}.`;
}

export function quantityUpdatedMessage(line: CartItem, cart: CartItem[]): string {
  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return `Updated *${line.itemName}* to x${line.quantity}. Cart: ${cart.length} item${cart.length === 1 ? '' : 's'}, ₹${subtotal}.`;
}

export function cartClearedMessage(): string {
  return 'Cart cleared. Tell me what you\'re craving whenever you\'re ready.';
}

export function cartBusyMessage(): string {
  return "Finish or *CANCEL* what you're doing first, then try that again.";
}

export function addItemNotFoundMessage(query: string): string {
  return `I couldn't find a 4-star-or-above match for "${query}" to add. Try a different dish.`;
}

export function removeItemNotFoundMessage(query: string): string {
  return `"${query}" isn't in your cart. Type *CART* to see what's there.`;
}

export function invalidConfirmMessage(): string {
  return 'Reply *CONFIRM* to place the order, or *CANCEL* to abort.';
}

export function orderPlacedMessage(order: Order): string {
  return [
    `Order placed! *${order.id}*`,
    statusMessage('CONFIRMED'),
    `Estimated delivery: ~${order.restaurantEtaMinutes} min.`,
    `Payment: ${PAYMENT_METHOD_LABEL[order.paymentMethod]}.`,
    'Type *STATUS* anytime to check progress.',
  ].join('\n');
}

export function statusUpdateMessage(order: Order, status: OrderStatus): string {
  const lines = [`*${order.id}*`, statusMessage(status)];
  if (isPartnerAssigned(status)) {
    const partner = deliveryPartnerFor(order.id);
    lines.push(`Delivery partner: ${partner.name} (${partner.vehicle})`);
  }
  return lines.join('\n');
}

export function noActiveOrderMessage(): string {
  return "You don't have an active order. Type a dish to place one.";
}

export function tooLateToCancelMessage(): string {
  return "This order's already being prepared, so it's too late to cancel. Type *STATUS* to track it.";
}

export function orderCancelledAfterConfirmMessage(orderId: string): string {
  return `Order *${orderId}* cancelled — the restaurant hadn't started on it yet. Type a dish whenever you're ready to order again.`;
}

export function ratingPromptMessage(): string {
  return 'How was your order? Reply with a number *1* to *5*, or *SKIP*.';
}

export function ratingThanksMessage(rating: 1 | 2 | 3 | 4 | 5): string {
  return `Thanks for the ${rating}-star rating! It'll help me recommend better next time.`;
}

export function ratingSkippedMessage(): string {
  return 'No problem — type a dish whenever you want to order again.';
}

export function noPreviousOrderMessage(): string {
  return "You haven't placed an order with me yet, so there's nothing to reorder. Tell me what you're craving.";
}

export function cannotReorderMidFlowMessage(): string {
  return 'Finish or *CANCEL* what you\'re doing first, then type *REORDER* to order your last meal again.';
}

export function reorderNothingAvailableMessage(): string {
  return "Sorry, none of the dishes from that order are available anymore. Tell me what else you're craving.";
}

export function reorderAddedMessage(cart: CartItem[], addedCount: number, skippedNames: string[]): string {
  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const lines = [
    `Added ${addedCount} item${addedCount === 1 ? '' : 's'} from your last order back to your cart.`,
  ];
  if (skippedNames.length > 0) {
    lines.push(`(Skipped, no longer available: ${skippedNames.join(', ')}.)`);
  }
  lines.push(`Cart: ${cart.length} item${cart.length === 1 ? '' : 's'}, ₹${subtotal}.`);
  lines.push('Keep adding dishes, or type *CHECKOUT* when you\'re ready.');
  return lines.join('\n');
}

export function noUsualOrderMessage(): string {
  return "You don't have enough order history yet for me to know your usual. Tell me what you're craving.";
}

export function usualAddedMessage(line: CartItem, timesOrdered: number, cart: CartItem[]): string {
  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return [
    `Your usual is *${line.itemName}* from ${line.restaurantName} — you've ordered it ${timesOrdered}x before. Added it to your cart.`,
    `Cart: ${cart.length} item${cart.length === 1 ? '' : 's'}, ₹${subtotal}.`,
    'Keep adding dishes, or type *CHECKOUT* when you\'re ready.',
  ].join('\n');
}

export function fallbackMessage(): string {
  return "I didn't quite get that. Type *HELP* to see what I can do, or tell me a dish you'd like.";
}
