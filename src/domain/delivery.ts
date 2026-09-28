import type { Order, OrderStatus } from './order.js';

interface Stage {
  status: OrderStatus;
  afterMs: number;
}

/**
 * Fixed timeline relative to placedAt, scaled for a live demo rather than a
 * real delivery (a real order takes 30-60 minutes; this takes 90 seconds so
 * a reviewer can watch it complete without waiting).
 */
const STAGES: Stage[] = [
  { status: 'CONFIRMED', afterMs: 0 },
  { status: 'PREPARING', afterMs: 15_000 },
  { status: 'PICKED_UP', afterMs: 35_000 },
  { status: 'OUT_FOR_DELIVERY', afterMs: 55_000 },
  { status: 'DELIVERED', afterMs: 90_000 },
];

export function statusAt(placedAt: number, now: number): OrderStatus {
  const elapsed = now - placedAt;
  let current: OrderStatus = 'CONFIRMED';
  for (const stage of STAGES) {
    if (elapsed >= stage.afterMs) current = stage.status;
  }
  return current;
}

export function isDelivered(order: Order, now: number): boolean {
  return statusAt(order.placedAt, now) === 'DELIVERED';
}

const STATUS_COPY: Record<OrderStatus, string> = {
  CONFIRMED: 'Order confirmed — the restaurant has received it.',
  PREPARING: 'Being prepared in the kitchen.',
  PICKED_UP: 'Picked up by your delivery partner.',
  OUT_FOR_DELIVERY: 'Out for delivery — on its way to you!',
  DELIVERED: 'Delivered. Enjoy your meal!',
};

/** True from the moment a delivery partner has physically picked up the order. */
export function isPartnerAssigned(status: OrderStatus): boolean {
  return status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED';
}

export function statusMessage(status: OrderStatus): string {
  return STATUS_COPY[status];
}

const PARTNER_NAMES = [
  'Ravi Kumar', 'Suresh Patel', 'Anjali Singh', 'Vikram Rao',
  'Priya Nair', 'Arjun Mehta', 'Sneha Gupta', 'Karthik Iyer',
];
const VEHICLES = ['bike', 'scooter'];

/** Deterministic pseudo-random in [0, n) seeded by a string - same order id always gets the same partner. */
function hashToIndex(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % n;
}

export interface DeliveryPartner {
  name: string;
  vehicle: string;
}

/**
 * Flavor text only, not real dispatch data - assigned once an order is out
 * for delivery, consistently for the life of that order (same order id
 * always resolves to the same partner instead of a new name each check).
 */
export function deliveryPartnerFor(orderId: string): DeliveryPartner {
  return {
    name: PARTNER_NAMES[hashToIndex(orderId, PARTNER_NAMES.length)]!,
    vehicle: VEHICLES[hashToIndex(`${orderId}-v`, VEHICLES.length)]!,
  };
}
