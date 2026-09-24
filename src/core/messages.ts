import type { Bill, CartItem, Order, OrderStatus } from '../domain/order.js';
import type { Promo } from '../domain/types.js';
import type { Recommendation } from '../domain/types.js';
import { statusMessage } from '../domain/delivery.js';

const HELP_TEXT = [
  '*How this works*',
  'Type a dish, e.g. "Veg Biryani", and I will suggest three highly-rated options.',
  '',
  'Anytime, you can type:',
  '*MENU* — start a fresh search',
  '*STATUS* — check your current order',
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

export function recommendationsMessage(recs: Recommendation[]): string {
  const lines = recs.map((r, i) => {
    const { entry } = r;
    const vegTag = entry.item.veg ? '🟢' : '🔴';
    return [
      `*${i + 1}. ${entry.item.name}* ${vegTag}`,
      `${entry.restaurant.name} · ₹${entry.item.price}`,
      r.reason,
    ].join('\n');
  });

  return [
    `Here are my top ${recs.length} picks:`,
    '',
    lines.join('\n\n'),
    '',
    'Reply *1*, *2* or *3* to choose, or type another dish to search again.',
  ].join('\n');
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
      'Reply *APPLY* to use it, type a different code, or *SKIP*.',
    ].join('\n');
  }
  return 'Have a promo code? Type it now, or reply *SKIP*.';
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

function billLines(cart: CartItem, bill: Bill): string[] {
  const lines = [
    `${cart.itemName} x${cart.quantity} — ₹${bill.subtotal}`,
  ];
  if (bill.discount > 0) {
    lines.push(`Discount${bill.appliedPromoCode ? ` (${bill.appliedPromoCode})` : ''}: -₹${bill.discount}`);
  }
  lines.push(`Delivery fee: ₹${bill.deliveryFee}`);
  lines.push(`GST: ₹${bill.gst}`);
  lines.push(`*Total: ₹${bill.total}*`);
  return lines;
}

export function billMessage(cart: CartItem, bill: Bill, address: string): string {
  return [
    '*Order summary*',
    `${cart.restaurantName}`,
    '',
    ...billLines(cart, bill),
    '',
    `Deliver to: ${address}`,
    '',
    'Reply *CONFIRM* to place the order, or *CANCEL* to abort.',
  ].join('\n');
}

export function invalidConfirmMessage(): string {
  return 'Reply *CONFIRM* to place the order, or *CANCEL* to abort.';
}

export function orderPlacedMessage(order: Order): string {
  return [
    `Order placed! *${order.id}*`,
    statusMessage('CONFIRMED'),
    `Estimated delivery: ~${order.restaurantEtaMinutes} min.`,
    'Type *STATUS* anytime to check progress.',
  ].join('\n');
}

export function statusUpdateMessage(order: Order, status: OrderStatus): string {
  return [`*${order.id}*`, statusMessage(status)].join('\n');
}

export function noActiveOrderMessage(): string {
  return "You don't have an active order. Type a dish to place one.";
}

export function fallbackMessage(): string {
  return "I didn't quite get that. Type *HELP* to see what I can do, or tell me a dish you'd like.";
}
