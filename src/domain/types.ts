export interface MenuItem {
  id: string;
  name: string;
  veg: boolean;
  price: number;
  tags: string[];
}

export interface Restaurant {
  id: string;
  name: string;
  cuisines: string[];
  rating: number;
  etaMinutes: number;
  priceLevel: 1 | 2 | 3;
  available: boolean;
  items: MenuItem[];
}

/** A menu item flattened with its parent restaurant's context - what search returns. */
export interface CatalogEntry {
  restaurant: Restaurant;
  item: MenuItem;
}

export interface PastOrder {
  restaurantId: string;
  itemId: string;
  cuisine: string;
  daysAgo: number;
  rating: 1 | 2 | 3 | 4 | 5;
}

export interface Address {
  id: string;
  label: string;
  line: string;
  isDefault: boolean;
}

export interface UserProfile {
  phone: string;
  name: string;
  addresses: Address[];
  orderHistory: PastOrder[];
}

export type PromoType = 'percent' | 'flat';

export interface Promo {
  code: string;
  description: string;
  type: PromoType;
  value: number;
  maxDiscount: number;
  minOrderValue: number;
  firstOrderOnly: boolean;
  cuisineScope: string | null;
  restaurantScope: string | null;
  expired: boolean;
  usageLimitPerUser: number;
}

export interface Recommendation {
  entry: CatalogEntry;
  score: number;
  reason: string;
}
