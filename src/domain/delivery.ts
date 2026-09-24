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
  { status: 'OUT_FOR_DELIVERY', afterMs: 45_000 },
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
  OUT_FOR_DELIVERY: 'Out for delivery — on its way to you!',
  DELIVERED: 'Delivered. Enjoy your meal!',
};

export function statusMessage(status: OrderStatus): string {
  return STATUS_COPY[status];
}
