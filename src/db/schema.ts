import { boolean, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { Address, CatalogEntry, PastOrder, Recommendation } from '../domain/types.js';
import type { Order } from '../domain/order.js';
import type { ConversationState } from '../core/session.js';

export const restaurants = pgTable('restaurants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cuisines: jsonb('cuisines').$type<string[]>().notNull().default([]),
  rating: real('rating').notNull(),
  etaMinutes: integer('eta_minutes').notNull(),
  priceLevel: integer('price_level').notNull(),
  available: boolean('available').notNull().default(true),
});

export const menuItems = pgTable('menu_items', {
  id: text('id').primaryKey(),
  restaurantId: text('restaurant_id').notNull(),
  name: text('name').notNull(),
  veg: boolean('veg').notNull(),
  price: real('price').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  image: text('image'),
});

export const users = pgTable('users', {
  phone: text('phone').primaryKey(),
  name: text('name').notNull(),
  addresses: jsonb('addresses').$type<Address[]>().notNull().default([]),
  orderHistory: jsonb('order_history').$type<PastOrder[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Sessions mirror src/core/session.ts's Session shape almost 1:1 - complex
// nested fields (recommendations, the in-progress cart selection, the live
// order) stay as jsonb rather than being normalized, since they're only ever
// read/written whole, never queried by their inner fields.
export const sessions = pgTable('sessions', {
  phone: text('phone').primaryKey(),
  state: text('state').$type<ConversationState>().notNull(),
  shownRecommendations: jsonb('shown_recommendations').$type<Recommendation[]>().notNull().default([]),
  selected: jsonb('selected').$type<CatalogEntry | null>(),
  quantity: integer('quantity'),
  address: text('address'),
  appliedPromoCode: text('applied_promo_code'),
  appliedDiscount: real('applied_discount').notNull().default(0),
  currentOrder: jsonb('current_order').$type<Order | null>(),
  pendingRatingOrderId: text('pending_rating_order_id'),
  ratingHandledForOrderId: text('rating_handled_for_order_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
