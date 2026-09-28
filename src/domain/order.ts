export interface CartItem {
  restaurantId: string;
  restaurantName: string;
  itemId: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
}

export interface Bill {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  gst: number;
  total: number;
  appliedPromoCode: string | null;
}

const DELIVERY_FEE = 30;
const GST_RATE = 0.05;

/** Sum of unitPrice*quantity across every line in the cart. */
export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

export function computeBill(cart: CartItem[], discount = 0, promoCode: string | null = null): Bill {
  const subtotal = cartSubtotal(cart);
  const cappedDiscount = Math.min(discount, subtotal);
  const taxableAmount = subtotal - cappedDiscount;
  const gst = Math.round(taxableAmount * GST_RATE);
  const total = taxableAmount + DELIVERY_FEE + gst;

  return {
    subtotal,
    discount: cappedDiscount,
    deliveryFee: DELIVERY_FEE,
    gst,
    total,
    appliedPromoCode: promoCode,
  };
}

export type OrderStatus = 'CONFIRMED' | 'PREPARING' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

/** Demo-only - no real payment integration, just how the order is represented as paid for. */
export type PaymentMethod = 'COD' | 'UPI';

export interface Order {
  id: string;
  phone: string;
  cart: CartItem[];
  bill: Bill;
  address: string;
  paymentMethod: PaymentMethod;
  placedAt: number;
  /** Slowest ETA across every restaurant represented in the cart. */
  restaurantEtaMinutes: number;
}

export function generateOrderId(now: number): string {
  const stamp = now.toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${stamp}-${suffix}`;
}
