const state = {
  phone: null,
  users: [],
  orderId: null,
  eventSource: null,
  cart: [],
  bill: null,
  itemImageCache: {},
  trackingRefs: null,
};

// ============================================================
// Dish image resolver
// ============================================================
// Resolve known recommendation dishes by their actual dish name.
// This prevents a restaurant/catalog image from being shown for
// a different recommended dish. Unknown dishes keep their backend image.

const DISH_IMAGE_OVERRIDES = {
  "Veg Biryani": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Vegetable-biryani.jpg",
  "Haleem": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0f/Pakistani_Haleem_served_with_garnish.jpg/500px-Pakistani_Haleem_served_with_garnish.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Masala Dosa": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/ba/Masala_Dosa_2023.jpg/500px-Masala_Dosa_2023.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Fish Curry Rice": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Fish_Curry_with_Rice.jpg",
  "Kadai Paneer": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/Kadai_Paneer-Delhi-12.jpg/500px-Kadai_Paneer-Delhi-12.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Butter Chicken": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Butter_Chicken_%26_Butter_Naan_-_Home_-_Chandigarh_-_India_-_0006.jpg/500px-Butter_Chicken_%26_Butter_Naan_-_Home_-_Chandigarh_-_India_-_0006.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Gujarati Thali": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Gujarat_Thali.JPG/500px-Gujarat_Thali.JPG?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Veg Fried Rice": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/59/Chinese_fried_rice.jpg/500px-Chinese_fried_rice.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Chicken Manchurian": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Chicken_Manchurian_%28Hyderabad_Style%29_%2811960049916%29.jpg/500px-Chicken_Manchurian_%28Hyderabad_Style%29_%2811960049916%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Cold Coffee": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cold_coffee.jpg",
  "Chicken Burger": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chicken_Burger.jpg",
  "Margherita Pizza": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Neapolitan_pizza_at_Trappica_%2848701940197%29.jpg/500px-Neapolitan_pizza_at_Trappica_%2848701940197%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Farmhouse Pizza": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Farmhouse_Pizza-Domino%27s-Ahmedabad-Gujarat-202013-1.jpg",
  "Veg Burger": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Veggie_burger.jpg/500px-Veggie_burger.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
  "Chocolate Brownie": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Brownie.jpg",
  "Mango Lassi": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mango_Lassi.jpg",
  "Mishti Doi": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mishti_doi.jpg",
  "Kosha Mangsho": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kosha_Mangsho.jpg",
  "Chicken Seekh Kebab": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Seekh_kebab.jpg",
  "Curd Rice": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Curd_rice.jpg",
  "Loaded Fries": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Loaded_fries.jpg",
  "Filter Coffee": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Filter_coffee.jpg",
  "Masala Chai": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Masala_Chai.jpg",
  "Aloo Paratha": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Aloo_paratha.jpg",
  "Gulab Jamun": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Gulab_jamun.jpg",
  "Chole Bhature": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chole_bhature.jpg",
  "Chicken Lollipop": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chicken_lollipop.jpg",
  "Tandoori Roti": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Tandoori_roti.jpg",
  "Dal Makhani": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Dal_makhani.jpg",
  "Garlic Bread": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Garlic_bread.jpg",
  "Veg Momos": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Momo_nepal.jpg",
  "Chicken Momos": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Momo_chicken.jpg",
  "Thukpa": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Thukpa.jpg",
  "Medu Vada": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Medu_vada.jpg",
  "Idli Sambar": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Idli_sambar.jpg",
  "Veg Spring Rolls": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Spring_rolls.jpg",
  "Veg Hakka Noodles": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Hakka_noodles.jpg",
  "Nachos": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Nachos.jpg",
  "Pasta": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Pasta.jpg",
  "Cocktail": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cocktail.jpg",
  "Mocktail": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mocktail.jpg",
  "Waffle": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Waffle.jpg",
  "Pancake": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Pancakes.jpg",
  "Ice Cream": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Ice_Cream.jpg",
  "Panipuri": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Pani_puri.jpg",
  "Pav Bhaji": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Pav_bhaji.jpg",
  "Chaat": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chaat.jpg",
  "Vegetable Sandwich": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Vegetable_sandwich.jpg",
  "Lassi": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Lassi.jpg",
  "Jalebi": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Jalebi.jpg",
  "Vada Pav": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Vada_Pav.jpg",
  "Sushi": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Sushi.jpg",
  "Samosa": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Samosa.jpg",
  "Poha": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Poha.jpg",
  "Omelette": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Omelette.jpg",
  "Steak": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Steak.jpg",
  "Taco": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Taco.jpg",
  "Chow Mein": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chow_mein.jpg",
  "Salad Platter": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Salad_platter.jpg",
  "Rasgulla": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Rasgulla.jpg",
  "Kaju Katli": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kaju_katli.jpg"
};

const DISH_IMAGE_ALIASES = {
  "berryblast": "Mocktail",
  "berry blast": "Mocktail",
  "virgin": "Mocktail",
  "virgin mojito": "Mocktail",
  "mocktail": "Mocktail",
  "lemonade": "Mocktail",
  "jal jeera": "Mocktail",
  "jal-jeera": "Mocktail",
  "jaljeera": "Mocktail",
  "aam panna": "Mocktail",
  "chaach": "Mocktail",
  "buttermilk": "Mocktail",
  "lime soda": "Mocktail",
  "shikanji": "Mocktail",
  "thandai": "Mocktail",
  "masala soda": "Mocktail",
  "sharbat": "Mocktail",
  "aamras": "Mocktail",

  "dumplings": "Veg Momos",
  "dumpling": "Veg Momos",
  "momo": "Veg Momos",
  "momos": "Veg Momos",
  "veg momo": "Veg Momos",
  "veg momos": "Veg Momos",
  "vegetable momos": "Veg Momos",

  "chicken momo": "Chicken Momos",
  "chicken momos": "Chicken Momos",

  "chicken burger": "Chicken Burger",
  "veg burger": "Veg Burger",
  "vegetable burger": "Veg Burger",

  "nachos": "Nachos",
  "loaded fries": "Loaded Fries",

  "veg hakka noodles": "Veg Hakka Noodles",
  "hakka noodles": "Veg Hakka Noodles",

  "chicken manchurian": "Chicken Manchurian",

  // These dishes do not have a verified exact image in the mapping,
  // so they deliberately return null instead of showing the wrong dish.
  "manchurian": null,
  "chaap": null,
  "soya chaap": null,
  "soy chaap": null,
  "keema pav": null,
  "chicken biryani": null,
  "mutton biryani": null,
  "egg biryani": null,
  "fish biryani": null,
  "pepperoni": null,
  "pepperoni pizza": null,
  "milkshake": null,
  "milk shake": null,
  "smoothie": null,
  "pulao": null,
  "pulav": null,
  "litti": null,
  "liti": null,
  "naan": null,
  "pita": null,
  "falafel": null,
  "fish fry": null,
  "chicken curry": null,
  "tandoori chicken": null,
  "shawarma": null,
  "kebab": null,
  "kabab": null
};

function normalizeFoodName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, '')
    .replace(/[-_]+/g, ' ');
}

function imageForDishName(name) {
  const normalized = normalizeFoodName(name);
  if (!normalized) return null;

  const exactKey = Object.keys(DISH_IMAGE_OVERRIDES).find(
    (key) => normalizeFoodName(key) === normalized,
  );

  if (exactKey) {
    return DISH_IMAGE_OVERRIDES[exactKey] || null;
  }

  if (Object.prototype.hasOwnProperty.call(DISH_IMAGE_ALIASES, normalized)) {
    const target = DISH_IMAGE_ALIASES[normalized];
    return target ? (DISH_IMAGE_OVERRIDES[target] || null) : null;
  }

  const phrases = Object.keys(DISH_IMAGE_ALIASES)
    .filter((key) => key.length > 3)
    .sort((a, b) => b.length - a.length);

  for (const phrase of phrases) {
    if (normalized.includes(phrase)) {
      const target = DISH_IMAGE_ALIASES[phrase];
      return target ? (DISH_IMAGE_OVERRIDES[target] || null) : null;
    }
  }

  return null;
}

function resolveItemImage(item) {
  if (!item) return null;

  const mappedImage = imageForDishName(item.name);

  if (mappedImage) {
    return mappedImage;
  }

  const normalized = normalizeFoodName(item.name);

  // If this is a known alias with no verified image, don't use
  // a potentially incorrect backend image.
  if (Object.prototype.hasOwnProperty.call(DISH_IMAGE_ALIASES, normalized)) {
    return null;
  }

  // For completely unknown dishes, preserve the backend image.
  return item.image || null;
}

// ---- DOM refs ----
const transcriptEl = document.getElementById('transcript');
const composer = document.getElementById('composer');
const textInput = document.getElementById('textInput');
const sendIconEl = document.getElementById('sendIcon');
const statusLineEl = document.getElementById('statusLine');

const backBtn = document.getElementById('backBtn');
const menuBtn = document.getElementById('menuBtn');
const menuDropdown = document.getElementById('menuDropdown');

const customerOverlay = document.getElementById('customerOverlay');
const customerClose = document.getElementById('customerClose');
const customerListEl = document.getElementById('customerList');

const addUserOverlay = document.getElementById('addUserOverlay');
const addUserForm = document.getElementById('addUserForm');
const addUserClose = document.getElementById('addUserClose');
const addUserCancel = document.getElementById('addUserCancel');
const addUserErrorEl = document.getElementById('addUserError');
const newUserNameInput = document.getElementById('newUserName');
const newUserPhoneInput = document.getElementById('newUserPhone');
const newUserAddressInput = document.getElementById('newUserAddress');

const preferencesOverlay = document.getElementById('preferencesOverlay');
const preferencesForm = document.getElementById('preferencesForm');
const preferencesClose = document.getElementById('preferencesClose');
const preferencesCancel = document.getElementById('preferencesCancel');
const preferencesErrorEl = document.getElementById('preferencesError');
const prefCuisines = document.getElementById('prefCuisines');
const prefDietary = document.getElementById('prefDietary');
const prefSpice = document.getElementById('prefSpice');
const prefBudget = document.getElementById('prefBudget');

const infoOverlay = document.getElementById('infoOverlay');
const infoTitleEl = document.getElementById('infoTitle');
const infoClose = document.getElementById('infoClose');
const infoBodyEl = document.getElementById('infoBody');
const infoSearchEl = document.getElementById('infoSearch');
const infoSearchInput = document.getElementById('infoSearchInput');

const toastContainerEl = document.getElementById('toastContainer');

const STEP_ORDER = [
  'CONFIRMED',
  'PREPARING',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED'
];

const STEP_LABELS = {
  CONFIRMED: 'Order Confirmed',
  PREPARING: 'Preparing',
  PICKED_UP: 'Picked Up',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
};

// Must match FOCUS_INPUT_ACTION in src/core/stateMachine.ts exactly.
const FOCUS_INPUT_ACTION = '__focus_input__';

// The five categories that actually exist in the backend's ComplaintCategory
// enum - a "Refund / payment issue" option is deliberately not offered here
// since no matching backend category exists and this is a UI-only pass.
const COMPLAINT_CATEGORIES = [
  {
    value: 'LATE_DELIVERY',
    label: 'Order delayed',
    icon: 'alertTriangle'
  },
  {
    value: 'WRONG_ITEM',
    label: 'Wrong item',
    icon: 'xCircle'
  },
  {
    value: 'MISSING_ITEM',
    label: 'Missing item',
    icon: 'package'
  },
  {
    value: 'FOOD_QUALITY',
    label: 'Food quality',
    icon: 'utensils'
  },
  {
    value: 'OTHER',
    label: 'Other',
    icon: 'messageCircle'
  },
];

const GIVE_MORE_COMMANDS = new Set([
  'GIVE ME MORE',
  'MORE',
  'SHOW MORE',
  'MORE OPTIONS',
  'MORE RECOMMENDATIONS'
]);

function isGiveMoreCommand(text) {
  return GIVE_MORE_COMMANDS.has(text.trim().toUpperCase());
}

const CART_VIEW_COMMANDS = new Set([
  'CART',
  'VIEW CART',
  'SHOW CART',
  'MY CART'
]);

function isCartViewCommand(text) {
  return CART_VIEW_COMMANDS.has(text.trim().toUpperCase());
}

const AVATAR_PALETTE = [
  '#5b6bd6',
  '#e2725b',
  '#a1558c',
  '#c2984f',
  '#3f7ea6',
  '#c2555f'
];

function avatarColorFor(phone) {
  let hash = 0;

  for (let i = 0; i < phone.length; i++) {
    hash = (hash * 31 + phone.charCodeAt(i)) >>> 0;
  }

  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function money(n) {
  return `₹${n}`;
}

function nowTime() {
  return new Date().toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function cacheItemImage(restaurantId, itemId, image) {
  if (!image) return;

  state.itemImageCache[`${restaurantId}:${itemId}`] = image;
}

function imageFor(restaurantId, itemId) {
  return state.itemImageCache[`${restaurantId}:${itemId}`] || null;
}

function placeholderImg(size) {
  return `<div style="width:${size}px;height:${size}px;border-radius:8px;background:var(--wa-backdrop);flex-shrink:0"></div>`;
}

// ============================================================
// Icons - small inline SVGs (stroke, currentColor) in place of emoji
// throughout the UI. No external icon font/request - self-contained.
// ============================================================

const ICON_PATHS = {
  search:
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',

  star:
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',

  cart:
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',

  package:
    '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73V8Z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',

  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',

  messageCircle:
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',

  user:
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',

  refresh:
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',

  tag:
    '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',

  plus:
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',

  creditCard:
    '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',

  mapPin:
    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',

  clock:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',

  truck:
    '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',

  fileText:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',

  alertTriangle:
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',

  xCircle:
    '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',

  utensils:
    '<path d="M3 2v7c0 1.1.9 2 2 2s2-.9 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',

  mic:
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',

  paperclip:
    '<path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95L9.64 18.36a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',

  send:
    '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',

  smile:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',

  check:
    '<polyline points="20 6 9 17 4 12"/>',

  checkCheck:
    '<polyline points="1 13 5 17 11 8"/><polyline points="7 13 11 17 21 5"/>',

  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',

  x:
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',

  list:
    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',

  chevronLeft:
    '<polyline points="15 18 9 12 15 6"/>',

  moreVertical:
    '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',

  arrowRight:
    '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};

function icon(name, opts = {}) {
  const size = opts.size || 16;
  const cls = opts.className ? ` ${opts.className}` : '';
  const fill = opts.filled ? 'currentColor' : 'none';

  return `<svg class="wa-icon${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

/** Small filled gold star for ratings - distinct styling from the stroke icons above. */
function starIcon(size) {
  return `<svg class="wa-icon wa-star-icon" width="${size || 12}" height="${size || 12}" viewBox="0 0 24 24" fill="#f5a623" stroke="#f5a623" stroke-width="1" aria-hidden="true" focusable="false">${ICON_PATHS.star}</svg>`;
}

/** The real Indian veg/non-veg pack mark: a coloured square outline with a filled dot. */
function dietMark(isVeg) {
  const color = isVeg ? '#0f8a3f' : '#8b2e2e';
  const label = isVeg ? 'Vegetarian' : 'Non-vegetarian';

  return `<svg class="wa-icon wa-diet-mark" width="14" height="14" viewBox="0 0 16 16" role="img" aria-label="${label}"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="8" cy="8" r="3.6" fill="${color}"/></svg>`;
}

// ============================================================
// Toasts - single-at-a-time, only for actions with no other chat feedback
// ============================================================

let activeToastTimer = null;

function showToast(message) {
  clearTimeout(activeToastTimer);

  toastContainerEl.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  toastContainerEl.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  activeToastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 200);
  }, 2200);
}

// ============================================================
// Chat transcript primitives
// ============================================================

function scrollToBottom() {
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function formatText(text) {
  return escapeHtml(text)
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function appendBubble(text, sender, quickReplies) {
  const row = document.createElement('div');
  row.className = `wa-row ${sender}`;

  const bubble = document.createElement('div');
  bubble.className = `bubble ${sender}`;
  bubble.innerHTML = formatText(text);

  if (quickReplies && quickReplies.length > 0) {
    bubble.appendChild(buildQuickReplies(quickReplies));
  }

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  meta.innerHTML =
    sender === 'user'
      ? `<span>${nowTime()}</span><span class="bubble-check">${icon('checkCheck', { size: 13 })}</span>`
      : `<span>${nowTime()}</span>`;

  bubble.appendChild(meta);
  row.appendChild(bubble);
  transcriptEl.appendChild(row);

  scrollToBottom();

  return bubble;
}

/** A rich white "message" - recommendations, cart, tracking, etc. Always bot-aligned, no bubble chrome. */
function appendCard(buildFn, opts = {}) {
  const row = document.createElement('div');
  row.className = 'wa-row bot';

  const card = document.createElement('div');
  card.className = 'wa-card-msg' + (opts.wide ? ' wide' : '');

  buildFn(card);

  row.appendChild(card);
  transcriptEl.appendChild(row);

  scrollToBottom();

  return card;
}

/** A raw element (e.g. the rec carousel, which draws its own card chrome per item) appended bot-aligned. */
function appendRaw(el) {
  const row = document.createElement('div');
  row.className = 'wa-row bot';

  row.appendChild(el);
  transcriptEl.appendChild(row);

  scrollToBottom();

  return row;
}

function buildQuickReplies(quickReplies) {
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';

  quickReplies.forEach((qr, i) => {
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.className =
      i === 0
        ? 'bubble-action-btn primary'
        : 'bubble-action-btn';

    btn.textContent = qr.label;

    btn.addEventListener('click', () => {
      if (qr.value === FOCUS_INPUT_ACTION) {
        textInput.focus();
        return;
      }

      actions
        .querySelectorAll('button')
        .forEach((b) => (b.disabled = true));

      actions.classList.add('resolved');

      sendMessage(qr.value, qr.label);
    });

    actions.appendChild(btn);
  });

  return actions;
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'wa-row bot';

  const el = document.createElement('div');
  el.className = 'wa-typing';
  el.innerHTML = '<span></span><span></span><span></span>';

  row.appendChild(el);
  transcriptEl.appendChild(row);

  scrollToBottom();

  return row;
}

// ============================================================
// Recommendations
// ============================================================

function badgeFor(rec) {
  const reason = rec.reason.toLowerCase();

  if (reason.includes('ordered')) return 'For you';
  if (rec.entry.restaurant.rating >= 4.7) return 'Highly rated';
  if (rec.entry.restaurant.etaMinutes <= 20) return 'Fastest';

  return null;
}

function buildRecCarousel(recommendations) {
  const wrap = document.createElement('div');
  wrap.className = 'wa-rec-carousel';

  recommendations.forEach((rec) => {
    const { entry } = rec;

    // Resolve the image from the actual dish name before rendering.
    entry.item.image = resolveItemImage(entry.item);

    cacheItemImage(
      entry.restaurant.id,
      entry.item.id,
      entry.item.image
    );

    const badge = badgeFor(rec);

    const card = document.createElement('div');
    card.className = 'wa-rec-card';

    card.innerHTML = `
      <div class="wa-rec-card-media">
        ${entry.item.image ? `<img src="${entry.item.image}" alt="" loading="lazy">` : ''}
        ${badge ? `<span class="wa-rec-badge">${escapeHtml(badge)}</span>` : ''}
      </div>

      <div class="wa-rec-card-body">
        <div class="wa-rec-card-name">
          ${escapeHtml(entry.item.name)}
          ${dietMark(entry.item.veg)}
        </div>

        <div class="wa-rec-card-meta">
          ${starIcon()}
          ${entry.restaurant.rating.toFixed(1)}
          ·
          <span class="wa-rec-card-price">
            ${money(entry.item.price)}
          </span>
          ·
          ${icon('clock', { size: 12 })}
          ${entry.restaurant.etaMinutes} min
        </div>

        <div class="wa-rec-card-actions">
          <button type="button" class="wa-rec-card-details">
            Details
          </button>

          <button type="button" class="wa-rec-card-add">
            Add to Cart
          </button>
        </div>
      </div>
    `;

    card
      .querySelector('.wa-rec-card-details')
      .addEventListener('click', () => openFoodDetail(entry));

    card
      .querySelector('.wa-rec-card-add')
      .addEventListener('click', (e) => {
        addToCart(
          entry.restaurant.id,
          entry.item.id,
          entry.item.name,
          1,
          e.currentTarget
        );
      });

    wrap.appendChild(card);
  });

  return wrap;
}

function appendRecommendations(recommendations, isMore) {
  appendBubble(
    isMore
      ? `Here${recommendations.length === 1 ? "'s" : ' are'} ${recommendations.length} more:`
      : 'Here are some great options I found:',
    'bot',
  );

  appendRaw(buildRecCarousel(recommendations));
  appendShowMoreButton();
}

function appendShowMoreButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wa-showmore-btn';

  btn.innerHTML =
    `${icon('list', { size: 14 })} Show More Options`;

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Finding more…';

    sendMessage(
      'GIVE ME MORE',
      'Show me more options'
    );
  });

  appendRaw(btn);

  const hint = document.createElement('div');
  hint.className = 'wa-hint';
  hint.textContent = 'Tap a card, or reply with a number.';

  appendRaw(hint);
}

// ============================================================
// Sending messages
// ============================================================

composer.addEventListener('submit', (event) => {
  event.preventDefault();

  const text = textInput.value.trim();

  if (!text) return;

  textInput.value = '';
  sendIconEl.innerHTML = icon('mic', { size: 19 });

  sendMessage(text);
});

textInput.addEventListener('input', () => {
  sendIconEl.innerHTML = textInput.value.trim()
    ? icon('send', { size: 18 })
    : icon('mic', { size: 19 });
});

/** displayText lets a programmatic send (quick reply, menu button) show a friendly bubble instead of the raw command text - a real user's own typed text is always echoed verbatim. */
async function sendMessage(text, displayText) {
  appendBubble(displayText ?? text, 'user');

  const typingRow = showTyping();

  try {
    const res = await fetch('/sim/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: state.phone,
        text
      }),
    });

    typingRow.remove();

    if (!res.ok) {
      throw new Error(`server responded ${res.status}`);
    }

    const data = await res.json();

    if (
      data.recommendations &&
      data.recommendations.length > 0
    ) {
      appendRecommendations(
        data.recommendations,
        isGiveMoreCommand(text)
      );
    } else if (isCartViewCommand(text)) {
      await refreshCartState();
      appendCartCard();
    } else {
      data.replies.forEach((reply, i) => {
        const isLast =
          i === data.replies.length - 1;

        appendBubble(
          reply,
          'bot',
          isLast ? data.quickReplies : null
        );
      });
    }

    if (
      data.orderId &&
      data.orderId !== state.orderId
    ) {
      state.orderId = data.orderId;

      await appendTrackingCard(
        data.orderId,
        'CONFIRMED',
        null
      );

      startTracking(data.orderId);
    }

    await refreshCartState();
  } catch (err) {
    typingRow.remove();

    appendBubble(
      'Something went wrong reaching the bot. Please try again.',
      'bot'
    );

    console.error(err);
  }
}

// ============================================================
// Welcome menu
// ============================================================

function appendWelcomeMenu(displayName) {
  appendCard((card) => {
    card.innerHTML = `
      <div class="wa-welcome">
        <img
          class="wa-welcome-logo"
          src="/assets/logo.png"
          alt=""
        />

        <div class="wa-welcome-name">
          AHAAR
        </div>
      </div>
    `;
  });

  appendBubble(
    displayName
      ? `Hi ${displayName.split(' ')[0]}!\nWelcome to Ahaar — your intelligent food ordering assistant.`
      : 'Hi!\nWelcome to Ahaar — your intelligent food ordering assistant.',
    'bot',
  );

  appendBubble(
    'What would you like to do today?',
    'bot'
  );

  appendCard(
    (card) => {
      const list = document.createElement('div');

      list.className = 'wa-menu-list';
      list.style.padding = '10px 12px 12px';

      list.innerHTML = `
        <button
          type="button"
          class="wa-menu-item-btn"
          data-action="search"
        >
          <span class="wa-menu-item-icon">
            ${icon('search', { size: 17 })}
          </span>
          Search Food
        </button>

        <button
          type="button"
          class="wa-menu-item-btn"
          data-action="recommended"
        >
          <span class="wa-menu-item-icon">
            ${icon('star', { size: 17 })}
          </span>
          Recommended for You
        </button>

        <button
          type="button"
          class="wa-menu-item-btn"
          data-action="cart"
        >
          <span class="wa-menu-item-icon">
            ${icon('cart', { size: 17 })}
          </span>
          View Cart
        </button>

        <button
          type="button"
          class="wa-menu-item-btn"
          data-action="orders"
        >
          <span class="wa-menu-item-icon">
            ${icon('package', { size: 17 })}
          </span>
          My Orders
        </button>

        <button
          type="button"
          class="wa-menu-item-btn"
          data-action="help"
        >
          <span class="wa-menu-item-icon">
            ${icon('messageCircle', { size: 17 })}
          </span>
          Help / Support
        </button>
      `;

      list
        .querySelector('[data-action="search"]')
        .addEventListener(
          'click',
          () => openBrowseMenu()
        );

      list
        .querySelector('[data-action="recommended"]')
        .addEventListener(
          'click',
          () =>
            // Raw text tokenizes to zero search terms (all stopwords),
            // so the recommender falls back to its history/preference
            // ranking over the whole catalog instead of a text-filtered search.
            sendMessage(
              'something for me please',
              'What do you recommend for me?'
            ),
        );

      list
        .querySelector('[data-action="cart"]')
        .addEventListener(
          'click',
          async () => {
            await refreshCartState();
            appendCartCard();
          }
        );

      list
        .querySelector('[data-action="orders"]')
        .addEventListener(
          'click',
          () => openMyOrders()
        );

      list
        .querySelector('[data-action="help"]')
        .addEventListener(
          'click',
          () => startHelpFlow()
        );

      card.appendChild(list);
    },
    { wide: true },
  );
}

// ============================================================
// Add to cart (rendered as a real chat exchange, not a silent REST call)
// ============================================================

async function addToCart(
  restaurantId,
  itemId,
  itemName,
  quantity,
  buttonEl,
  onDone
) {
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Adding…';
  }

  appendBubble(
    `Add ${itemName}`,
    'user'
  );

  const typingRow = showTyping();

  try {
    const res = await fetch(
      '/sim/cart/items',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: state.phone,
          restaurantId,
          itemId,
          quantity
        }),
      }
    );

    typingRow.remove();

    if (!res.ok) {
      const data =
        await res.json().catch(() => ({}));

      appendBubble(
        data.error && res.status === 409
          ? "I can't add that right now — let's finish what we're doing first."
          : "Sorry, I couldn't add that dish.",
        'bot',
      );

      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = 'Add to Cart';
      }

      return;
    }

    const data = await res.json();

    state.cart = data.cart;
    state.bill = data.bill;

    const line = data.cart.find(
      (l) =>
        l.restaurantId === restaurantId &&
        l.itemId === itemId
    );

    appendBubble(
      'Added to your cart.',
      'bot'
    );

    if (line) {
      appendAddedItemCard(line);
    }

    appendPostAddOptions();

    if (buttonEl) {
      buttonEl.innerHTML =
        `Added ${icon('check', { size: 12 })}`;

      setTimeout(() => {
        buttonEl.disabled = false;
        buttonEl.textContent = 'Add to Cart';
      }, 1100);
    }

    onDone && onDone();
  } catch (err) {
    typingRow.remove();

    console.error(err);

    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = 'Add to Cart';
    }
  }
}

function appendAddedItemCard(line) {
  appendCard((card) => {
    const img = imageFor(line.restaurantId, line.itemId);
    card.innerHTML = `
      <div class="wa-added-item">
        ${img ? `<img src="${img}" alt="">` : placeholderImg(42)}
        <div class="wa-added-item-info">
          <div class="wa-added-item-name">${escapeHtml(line.itemName)}</div>
          <div class="wa-added-item-price">${money(line.unitPrice)} × ${line.quantity}</div>
        </div>
        <div class="wa-added-check">${icon('check', { size: 12 })} Added</div>
      </div>
    `;
  });
}

function appendPostAddOptions() {
  appendBubble('Would you like to:', 'bot');
  appendCard(
    (card) => {
      const list = document.createElement('div');
      list.className = 'wa-menu-list';
      list.style.padding = '10px 12px 12px';
      list.innerHTML = `
        <button type="button" class="wa-menu-item-btn" data-action="view-cart"><span class="wa-menu-item-icon">${icon('cart', { size: 17 })}</span>View Cart</button>
        <button type="button" class="wa-menu-item-btn" data-action="add-more"><span class="wa-menu-item-icon">${icon('plus', { size: 17 })}</span>Add More Items</button>
        <button type="button" class="wa-menu-item-btn" data-action="checkout"><span class="wa-menu-item-icon">${icon('creditCard', { size: 17 })}</span>Checkout</button>
      `;
      list.querySelector('[data-action="view-cart"]').addEventListener('click', async () => {
        await refreshCartState();
        appendCartCard();
      });
      list.querySelector('[data-action="add-more"]').addEventListener('click', () => openBrowseMenu());
      list.querySelector('[data-action="checkout"]').addEventListener('click', () => sendMessage('CHECKOUT', 'Checkout'));
      card.appendChild(list);
    },
    { wide: true },
  );
}

// ============================================================
// Cart card
// ============================================================
async function refreshCartState() {
  if (!state.phone) return;
  const res = await fetch(`/sim/cart?phone=${encodeURIComponent(state.phone)}`);
  const data = await res.json();
  state.cart = data.cart;
  state.bill = data.bill;
}

function appendCartCard() {
  return appendCard((card) => renderCartCardInto(card));
}

function renderCartCardInto(card) {
  card.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'wa-cart-header';
  const title = document.createElement('span');
  title.innerHTML = `${icon('cart', { size: 16 })} Your Cart`;
  header.appendChild(title);
  if (state.cart.length > 0) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'wa-link-btn';
    clearBtn.style.marginLeft = 'auto';
    clearBtn.style.fontSize = '11.5px';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', async () => {
      const res = await fetch('/sim/cart/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: state.phone }),
      });
      if (!res.ok) return;
      const data = await res.json();
      state.cart = data.cart;
      state.bill = data.bill;
      renderCartCardInto(card);
      showToast('Cart cleared');
    });
    header.appendChild(clearBtn);
  }
  card.appendChild(header);

  if (state.cart.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'info-empty';
    empty.textContent = 'Your cart is empty. Ask Ahaar for something to eat!';
    card.appendChild(empty);
    return;
  }

  state.cart.forEach((line) => {
    const img = imageFor(line.restaurantId, line.itemId);
    const row = document.createElement('div');
    row.className = 'wa-cart-item';
    row.innerHTML = `
      ${img ? `<img src="${img}" alt="">` : placeholderImg(42)}
      <div class="wa-cart-item-info">
        <div class="wa-cart-item-name">${escapeHtml(line.itemName)}</div>
        <div class="wa-cart-item-price">${money(line.unitPrice)} × ${line.quantity}</div>
      </div>
      <div class="wa-cart-qty">
        <button type="button" class="wa-qty-btn" data-action="dec">−</button>
        <span class="wa-qty-value">${line.quantity}</span>
        <button type="button" class="wa-qty-btn" data-action="inc">+</button>
      </div>
      <button type="button" class="wa-cart-remove" aria-label="Remove">${icon('trash', { size: 15 })}</button>
    `;
    row.querySelector('[data-action="dec"]').addEventListener('click', () => changeQuantity(line, line.quantity - 1, card));
    row.querySelector('[data-action="inc"]').addEventListener('click', () => changeQuantity(line, line.quantity + 1, card));
    row.querySelector('.wa-cart-remove').addEventListener('click', () => removeCartItem(line, card));
    card.appendChild(row);
  });

  const bill = state.bill;
  const billWrap = document.createElement('div');
  billWrap.className = 'wa-cart-bill';
  billWrap.innerHTML = `
    <div class="wa-bill-row"><span>Subtotal</span><span>${money(bill.subtotal)}</span></div>
    ${bill.discount > 0 ? `<div class="wa-bill-row discount"><span>Discount${bill.appliedPromoCode ? ` (${escapeHtml(bill.appliedPromoCode)})` : ''}</span><span>−${money(bill.discount)}</span></div>` : ''}
    <div class="wa-bill-row"><span>Delivery Fee</span><span>${money(bill.deliveryFee)}</span></div>
    <div class="wa-bill-row"><span>GST</span><span>${money(bill.gst)}</span></div>
  `;
  card.appendChild(billWrap);

  const totalRow = document.createElement('div');
  totalRow.className = 'wa-cart-total';
  totalRow.innerHTML = `<span>TOTAL</span><span>${money(bill.total)}</span>`;
  card.appendChild(totalRow);

  const actions = document.createElement('div');
  actions.className = 'wa-cart-actions';
  const checkoutBtn = document.createElement('button');
  checkoutBtn.type = 'button';
  checkoutBtn.className = 'wa-primary-btn';
  checkoutBtn.innerHTML = `${icon('arrowRight', { size: 15 })} Proceed to Checkout`;
  checkoutBtn.addEventListener('click', () => sendMessage('CHECKOUT', 'Checkout'));
  actions.appendChild(checkoutBtn);
  card.appendChild(actions);
}

async function changeQuantity(line, newQty, cardEl) {
  if (newQty < 1) return removeCartItem(line, cardEl);
  if (newQty > 10) return;
  const res = await fetch('/sim/cart/items', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: state.phone, restaurantId: line.restaurantId, itemId: line.itemId, quantity: newQty }),
  });
  if (!res.ok) return;
  const data = await res.json();
  state.cart = data.cart;
  state.bill = data.bill;
  renderCartCardInto(cardEl);
  showToast('Cart updated');
}

async function removeCartItem(line, cardEl) {
  const res = await fetch('/sim/cart/items', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: state.phone, restaurantId: line.restaurantId, itemId: line.itemId }),
  });
  if (!res.ok) return;
  const data = await res.json();
  state.cart = data.cart;
  state.bill = data.bill;
  renderCartCardInto(cardEl);
  showToast('Removed from cart');
}

// ============================================================
// Order tracking card (chat-embedded, live via SSE)
// ============================================================
function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

async function appendTrackingCard(orderId, status, partner) {
  const stepEls = {};
  let partnerEl;
  appendCard(
    (card) => {
      const header = document.createElement('div');
      header.className = 'wa-tracking-card';

      const h = document.createElement('div');
      h.className = 'wa-tracking-header';
      h.innerHTML = `${icon('mapPin', { size: 15 })} Order Tracking`;
      header.appendChild(h);

      const idLine = document.createElement('div');
      idLine.className = 'wa-tracking-order-id';
      idLine.textContent = `Order #${orderId}`;
      header.appendChild(idLine);

      const timeline = document.createElement('div');
      timeline.className = 'wa-timeline';
      STEP_ORDER.forEach((step) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'wa-timeline-step';
        const dot = document.createElement('span');
        dot.className = 'wa-timeline-dot';
        const labelWrap = document.createElement('div');
        labelWrap.textContent = STEP_LABELS[step];
        const time = document.createElement('div');
        time.className = 'wa-timeline-step-time';
        labelWrap.appendChild(time);
        stepEl.appendChild(dot);
        stepEl.appendChild(labelWrap);
        timeline.appendChild(stepEl);
        stepEls[step] = { stepEl, dot, time };
      });
      header.appendChild(timeline);
      card.appendChild(header);

      const partnerWrap = document.createElement('div');
      partnerWrap.className = 'wa-partner-note hidden';
      card.appendChild(partnerWrap);
      partnerEl = partnerWrap;
    },
    { wide: true },
  );

  state.trackingRefs = { stepEls, partnerEl, orderId };
  updateTrackingCard(status, partner);

  try {
    const res = await fetch(`/sim/orders?phone=${encodeURIComponent(state.phone)}`);
    const data = await res.json();
    const order = data.orders.find((o) => o.id === orderId);
    if (order && order.partner) {
      updateTrackingCard(order.status, order.partner);
    }
  } catch (err) {
    console.error(err);
  }
}

function updateTrackingCard(status, partner) {
  const refs = state.trackingRefs;
  if (!refs) return;
  const currentIndex = STEP_ORDER.indexOf(status);
  const now = nowTime();
  STEP_ORDER.forEach((step, i) => {
    const { stepEl, dot, time } = refs.stepEls[step];
    const isDone = i < currentIndex || (i === currentIndex && status === 'DELIVERED');
    stepEl.classList.toggle('done', isDone);
    stepEl.classList.toggle('current', i === currentIndex && !isDone);
    dot.innerHTML = isDone ? icon('check', { size: 9 }) : '';
    if (isDone && !time.textContent) time.textContent = now;
  });
  if (partner) {
    refs.partnerEl.innerHTML = `${icon('truck', { size: 15 })} ${escapeHtml(partner.name)} is delivering your order (${escapeHtml(partner.vehicle)})`;
    refs.partnerEl.classList.remove('hidden');
  } else {
    refs.partnerEl.classList.add('hidden');
  }
  statusLineEl.textContent = status === 'DELIVERED' ? 'delivered' : 'online';
}

function appendOrderItemsCard(order) {
  appendCard(
    (card) => {
      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'wa-order-items';
      itemsWrap.innerHTML = '<div class="wa-order-items-label">ITEMS IN YOUR ORDER</div>';
      order.cart.forEach((line) => {
        const img = imageFor(line.restaurantId, line.itemId);
        const row = document.createElement('div');
        row.className = 'wa-order-item-row';
        row.innerHTML = `
          ${img ? `<img src="${img}" alt="">` : placeholderImg(28)}
          <span class="name">${escapeHtml(line.itemName)} × ${line.quantity}</span>
          <span class="price">${money(line.unitPrice * line.quantity)}</span>
        `;
        itemsWrap.appendChild(row);
      });
      card.appendChild(itemsWrap);

      const totalRow = document.createElement('div');
      totalRow.className = 'wa-order-total-row';
      totalRow.innerHTML = `<span>Total Paid</span><span class="value">${money(order.bill.total)}</span>`;
      card.appendChild(totalRow);

      const linkRow = document.createElement('div');
      linkRow.className = 'wa-link-row';
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'wa-link-btn';
      link.innerHTML = `${icon('fileText', { size: 13 })} View Order Details`;
      link.addEventListener('click', () => openMyOrders());
      linkRow.appendChild(link);
      card.appendChild(linkRow);
    },
    { wide: true },
  );
}

function startTracking(orderId) {
  closeStream();
  const url = `/sim/orders/${encodeURIComponent(orderId)}/stream?phone=${encodeURIComponent(state.phone)}`;
  const es = new EventSource(url);
  state.eventSource = es;
  es.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (state.trackingRefs && state.trackingRefs.orderId === orderId) {
      updateTrackingCard(payload.status, payload.partner);
    }
    if (payload.status === 'DELIVERED') closeStream();
  };
  es.onerror = () => closeStream();
}

async function restoreActiveOrder(phone) {
  try {
    const res = await fetch(`/sim/orders/current?phone=${encodeURIComponent(phone)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.order || state.phone !== phone) return;
    state.orderId = data.order.id;
    await appendTrackingCard(data.order.id, data.order.status, data.order.partner);
    startTracking(data.order.id);
  } catch (err) {
    console.error(err);
  }
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = menuDropdown.classList.contains('hidden');
  menuDropdown.classList.toggle('hidden');
  menuBtn.setAttribute('aria-expanded', String(isHidden));
});

document.addEventListener('click', (e) => {
  if (
    !menuDropdown.classList.contains('hidden') &&
    !menuDropdown.contains(e.target) &&
    e.target !== menuBtn
  ) {
    menuDropdown.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
});

menuDropdown.querySelectorAll('button[data-menu-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    menuDropdown.classList.add('hidden');

    const action = btn.dataset.menuAction;

    if (action === 'switch-customer') {
      openCustomerSheet();
    } else if (action === 'new-order') {
      await fetch('/sim/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: state.phone,
          text: 'MENU'
        }),
      });

      appendWelcomeMenu(null);
      await refreshCartState();
    } else if (action === 'my-orders') {
      openMyOrders();
    } else if (action === 'preferences') {
      openPreferences();
    } else if (action === 'promos') {
      openPromoCodes();
    } else if (action === 'help') {
      startHelpFlow();
    }
  });
});

backBtn.addEventListener('click', () => openCustomerSheet());

// ============================================================
// Switch customer sheet
// ============================================================

function buildAddUserRow() {
  const row = document.createElement('button');

  row.type = 'button';
  row.className = 'user-row add-user-row';
  row.setAttribute('aria-label', 'Add a new customer');

  row.innerHTML = `
    <span class="user-avatar user-avatar-ghost">+</span>
    <span class="user-meta">
      <span class="user-name">Add new customer</span>
    </span>
  `;

  row.addEventListener('click', () => {
    closeCustomerSheet();
    openAddUserModal();
  });

  return row;
}

function buildUserRow(phone, name) {
  const row = document.createElement('button');

  row.type = 'button';
  row.className =
    'user-row' +
    (phone === state.phone ? ' active' : '');

  row.dataset.key = phone;
  row.setAttribute('aria-label', name);

  row.innerHTML = `
    <span
      class="user-avatar"
      style="background:${avatarColorFor(phone)}"
    >
      ${escapeHtml(name.charAt(0).toUpperCase())}
    </span>

    <span class="user-meta">
      <span class="user-name">
        ${escapeHtml(name)}
      </span>
    </span>
  `;

  row.addEventListener('click', async () => {
    closeCustomerSheet();
    await switchUser(phone, name);
  });

  return row;
}

function openCustomerSheet() {
  customerListEl.innerHTML = '';

  state.users.forEach((u) => {
    customerListEl.appendChild(
      buildUserRow(u.phone, u.name)
    );
  });

  customerListEl.appendChild(
    buildAddUserRow()
  );

  customerOverlay.classList.remove('hidden');
}

function closeCustomerSheet() {
  customerOverlay.classList.add('hidden');
}

customerClose.addEventListener(
  'click',
  closeCustomerSheet
);

customerOverlay.addEventListener('click', (e) => {
  if (e.target === customerOverlay) {
    closeCustomerSheet();
  }
});

async function loadUsers() {
  const res = await fetch('/sim/users');
  const data = await res.json();

  state.users = data.users;
}

function closeAllSheets() {
  customerOverlay.classList.add('hidden');
  addUserOverlay.classList.add('hidden');
  preferencesOverlay.classList.add('hidden');
  infoOverlay.classList.add('hidden');
  menuDropdown.classList.add('hidden');
}

// ============================================================
// Add customer
// ============================================================

function openAddUserModal() {
  addUserErrorEl.classList.add('hidden');
  addUserErrorEl.textContent = '';

  addUserForm.reset();

  addUserOverlay.classList.remove('hidden');

  newUserNameInput.focus();
}

function closeAddUserModal() {
  addUserOverlay.classList.add('hidden');
}

addUserClose.addEventListener(
  'click',
  closeAddUserModal
);

addUserCancel.addEventListener(
  'click',
  closeAddUserModal
);

addUserOverlay.addEventListener('click', (e) => {
  if (e.target === addUserOverlay) {
    closeAddUserModal();
  }
});

addUserForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const name =
      newUserNameInput.value.trim();

    if (!name) return;

    const payload = { name };

    const phone =
      newUserPhoneInput.value.trim();

    if (phone) {
      payload.phone = phone;
    }

    const address =
      newUserAddressInput.value.trim();

    if (address) {
      payload.address = address;
    }

    const res = await fetch(
      '/sim/users',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const data =
        await res.json().catch(() => ({}));

      addUserErrorEl.textContent =
        data.error ||
        'Could not add this customer. Please try again.';

      addUserErrorEl.classList.remove(
        'hidden'
      );

      return;
    }

    const newUser = await res.json();

    closeAddUserModal();

    await loadUsers();

    await switchUser(
      newUser.phone,
      newUser.name
    );
  }
);

// ============================================================
// Preferences
// ============================================================

async function openPreferences() {
  if (!state.phone) return;

  preferencesErrorEl.classList.add(
    'hidden'
  );

  try {
    const res = await fetch(
      `/sim/profile?phone=${encodeURIComponent(state.phone)}`
    );

    const data = await res.json();

    const prefs =
      data.profile.preferences || {};

    prefCuisines.value =
      (prefs.cuisines || []).join(', ');

    prefDietary.value =
      prefs.dietary || '';

    prefSpice.value =
      prefs.spiceLevel || '';

    prefBudget.value =
      prefs.budgetMax || '';
  } catch (err) {
    console.error(err);
  }

  preferencesOverlay.classList.remove(
    'hidden'
  );
}

function closePreferences() {
  preferencesOverlay.classList.add(
    'hidden'
  );
}

preferencesClose.addEventListener(
  'click',
  closePreferences
);

preferencesCancel.addEventListener(
  'click',
  closePreferences
);

preferencesOverlay.addEventListener(
  'click',
  (e) => {
    if (e.target === preferencesOverlay) {
      closePreferences();
    }
  }
);

preferencesForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const cuisines =
      prefCuisines.value
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

    const preferences = {
      cuisines,
      dietary: prefDietary.value || null,
      spiceLevel: prefSpice.value || null,
      budgetMax: prefBudget.value
        ? Number(prefBudget.value)
        : null,
    };

    const res = await fetch(
      '/sim/preferences',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: state.phone,
          preferences
        }),
      }
    );

    if (!res.ok) {
      const data =
        await res.json().catch(() => ({}));

      preferencesErrorEl.textContent =
        data.error ||
        'Could not save your preferences.';

      preferencesErrorEl.classList.remove(
        'hidden'
      );

      return;
    }

    closePreferences();

    appendBubble(
      "Saved your preferences — I'll factor them into your recommendations from now on.",
      'bot'
    );
  }
);

// ============================================================
// Generic sheet: Browse menu / My orders / Promo codes / Food detail
// ============================================================

function skeletonCardsHTML(count) {
  return `
    <div class="browse-grid">
      ${Array.from(
    { length: count },
    () =>
      '<div class="browse-skeleton"></div>'
  ).join('')}
    </div>
  `;
}

function openInfoModal(title, body) {
  infoTitleEl.textContent = title;
  infoBodyEl.innerHTML = body;
  infoOverlay.classList.remove('hidden');
}

function closeInfoModal() {
  infoOverlay.classList.add('hidden');
}

infoClose.addEventListener(
  'click',
  closeInfoModal
);

infoOverlay.addEventListener('click', (e) => {
  if (e.target === infoOverlay) {
    closeInfoModal();
  }
});

// ============================================================
// Browse menu
// ============================================================

function openBrowseMenu() {
  appendCard(
    (card) => {
      card.innerHTML = `
        <div class="wa-browse-header">
          <div>
            <div class="wa-browse-title">
              Search Food
            </div>

            <div class="wa-browse-subtitle">
              Find dishes, cuisines or restaurants
            </div>
          </div>
        </div>

        <div class="wa-browse-search">
          <input
            type="text"
            placeholder="Search for food..."
            autocomplete="off"
          />

          <button
            type="button"
            class="wa-primary-btn"
          >
            ${icon('search', { size: 15 })}
            Search
          </button>
        </div>

        <div class="wa-browse-results"></div>
      `;

      const input =
        card.querySelector(
          '.wa-browse-search input'
        );

      const button =
        card.querySelector(
          '.wa-browse-search button'
        );

      const results =
        card.querySelector(
          '.wa-browse-results'
        );

      const performSearch = async () => {
        const query =
          input.value.trim();

        if (!query) {
          results.innerHTML =
            '<div class="info-empty">Enter something to search.</div>';
          return;
        }

        results.innerHTML =
          skeletonCardsHTML(6);

        await renderBrowseResults(
          results,
          query
        );
      };

      button.addEventListener(
        'click',
        performSearch
      );

      input.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            performSearch();
          }
        }
      );

      setTimeout(() => input.focus(), 0);
    },
    { wide: true }
  );
}

async function renderBrowseResults(
  container,
  query
) {
  try {
    const res = await fetch(
      `/sim/catalog?q=${encodeURIComponent(query)}`
    );

    if (!res.ok) {
      throw new Error(
        `catalog responded ${res.status}`
      );
    }

    const data = await res.json();

    const entries =
      data.entries ||
      data.results ||
      [];

    container.innerHTML = '';

    if (!entries.length) {
      container.innerHTML = `
        <div class="info-empty">
          No matching food found.
        </div>
      `;

      return;
    }

    const grid =
      document.createElement('div');

    grid.className = 'browse-grid';

    entries
      .slice(0, 60)
      .forEach(({ restaurant, item }) => {

        // IMPORTANT:
        // Resolve the image from the actual dish name.
        // This is the second place where the image correction
        // must be applied.
        item.image =
          resolveItemImage(item);

        cacheItemImage(
          restaurant.id,
          item.id,
          item.image
        );

        const card =
          document.createElement('div');

        card.className =
          'wa-browse-card';

        card.innerHTML = `
          <div class="wa-browse-card-media">
            ${item.image
            ? `<img src="${item.image}" alt="" loading="lazy">`
            : ''
          }
          </div>

          <div class="wa-browse-card-body">
            <div class="wa-browse-card-name">
              ${escapeHtml(item.name)}
              ${dietMark(item.veg)}
            </div>

            <div class="wa-browse-card-restaurant">
              ${escapeHtml(restaurant.name)}
            </div>

            <div class="wa-browse-card-meta">
              ${starIcon()}
              ${Number(restaurant.rating || 0).toFixed(1)}
              ·
              ${money(item.price)}
              ·
              ${icon('clock', { size: 12 })}
              ${restaurant.etaMinutes} min
            </div>

            <div class="wa-browse-card-actions">
              <button
                type="button"
                class="wa-link-btn browse-details"
              >
                Details
              </button>

              <button
                type="button"
                class="wa-primary-btn browse-add"
              >
                Add to Cart
              </button>
            </div>
          </div>
        `;

        card
          .querySelector(
            '.browse-details'
          )
          .addEventListener(
            'click',
            () =>
              openFoodDetail({
                restaurant,
                item
              })
          );

        card
          .querySelector(
            '.browse-add'
          )
          .addEventListener(
            'click',
            (e) => {
              addToCart(
                restaurant.id,
                item.id,
                item.name,
                1,
                e.currentTarget
              );
            }
          );

        grid.appendChild(card);
      });

    container.appendChild(grid);
  } catch (err) {
    console.error(err);

    container.innerHTML = `
      <div class="info-empty">
        Something went wrong while searching.
        Please try again.
      </div>
    `;
  }
}

// ============================================================
// Food detail
// ============================================================

function openFoodDetail(entry) {
  const {
    restaurant,
    item
  } = entry;

  // IMPORTANT:
  // Always resolve the image again when opening details.
  item.image =
    resolveItemImage(item);

  cacheItemImage(
    restaurant.id,
    item.id,
    item.image
  );

  const image =
    item.image
      ? `
        <img
          class="wa-food-detail-image"
          src="${item.image}"
          alt=""
        >
      `
      : placeholderImg(180);

  appendCard(
    (card) => {
      card.innerHTML = `
        <div class="wa-food-detail">
          <div class="wa-food-detail-media">
            ${image}
          </div>

          <div class="wa-food-detail-content">
            <div class="wa-food-detail-name">
              ${escapeHtml(item.name)}
              ${dietMark(item.veg)}
            </div>

            <div class="wa-food-detail-restaurant">
              ${escapeHtml(restaurant.name)}
            </div>

            <div class="wa-food-detail-meta">
              ${starIcon()}
              ${Number(restaurant.rating || 0).toFixed(1)}
              ·
              ${money(item.price)}
              ·
              ${icon('clock', { size: 13 })}
              ${restaurant.etaMinutes} min
            </div>

            ${item.description
          ? `
                  <div class="wa-food-detail-description">
                    ${escapeHtml(item.description)}
                  </div>
                `
          : ''
        }

            <button
              type="button"
              class="wa-primary-btn wa-food-detail-add"
            >
              ${icon('cart', { size: 15 })}
              Add to Cart
            </button>
          </div>
        </div>
      `;

      card
        .querySelector(
          '.wa-food-detail-add'
        )
        .addEventListener(
          'click',
          (e) => {
            addToCart(
              restaurant.id,
              item.id,
              item.name,
              1,
              e.currentTarget
            );
          }
        );
    },
    { wide: true }
  );
}

// ---- Promo codes ----
async function openPromoCodes() {
  openInfoModal('Promo Codes');
  const res = await fetch('/sim/promos');
  const data = await res.json();
  const active = data.promos.filter((p) => !p.expired);
  if (active.length === 0) {
    infoBodyEl.innerHTML = '<div class="info-empty">No active promo codes right now.</div>';
    return;
  }
  infoBodyEl.innerHTML = active
    .map(
      (p) => `
      <div class="promo-list-item">
        <div class="promo-list-code">${escapeHtml(p.code)}</div>
        <div class="promo-list-desc">${escapeHtml(p.description)}</div>
        <div class="promo-list-meta">Min order ${money(p.minOrderValue)} · up to ${money(p.maxDiscount)} off${p.firstOrderOnly ? ' · first order only' : ''}</div>
      </div>
    `,
    )
    .join('');
  infoBodyEl.insertAdjacentHTML(
    'beforeend',
    '<div class="info-empty" style="text-align:left;padding-top:4px">Codes apply automatically at checkout — just ask for "the best discount" and Ahaar will pick the best one for you.</div>',
  );
}

// ============================================================
// Support / complaints
// ============================================================
async function startHelpFlow() {
  appendBubble('How can we help?', 'bot');

  let currentOrderId = null;

  try {
    const res = await fetch(`/sim/orders/current?phone=${encodeURIComponent(state.phone)}`);
    const data = await res.json();
    currentOrderId = data.order ? data.order.id : null;
  } catch (err) {
    console.error(err);
  }

  if (!currentOrderId) {
    appendBubble(
      "You don't have a recent order to report an issue about yet. Place an order first, and I can help from there.",
      'bot',
    );
    return;
  }

  openSupportCategoryCard(currentOrderId);
}

function reportIssueForOrder(orderId) {
  closeInfoModal();
  appendBubble('How can we help?', 'bot');
  openSupportCategoryCard(orderId);
}

function openSupportCategoryCard(orderId) {
  appendCard(
    (card) => {
      const wrap = document.createElement('div');
      wrap.className = 'wa-support-categories';
      COMPLAINT_CATEGORIES.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wa-support-cat-btn';
        btn.innerHTML = `${icon(c.icon, { size: 17 })}<span>${escapeHtml(c.label)}</span>`;
        btn.addEventListener('click', () => {
          wrap.querySelectorAll('button').forEach((b) => {
            b.disabled = true;
          });
          appendBubble(c.label, 'user');
          openSupportDescriptionCard(orderId, c.value);
        });
        wrap.appendChild(btn);
      });
      card.appendChild(wrap);
    },
    { wide: true },
  );
}

function openSupportDescriptionCard(orderId, category) {
  appendBubble("Got it. Describe your issue if you'd like to add details, or just submit.", 'bot');

  appendCard(
    (card) => {
      const wrap = document.createElement('div');
      wrap.className = 'wa-support-form';
      wrap.innerHTML = `
        <textarea rows="3" placeholder="Describe your issue…"></textarea>
        <button type="button" class="wa-primary-btn">Submit Complaint</button>
      `;
      const textarea = wrap.querySelector('textarea');
      const submitBtn = wrap.querySelector('button');
      submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
        try {
          const res = await fetch('/sim/complaints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: state.phone,
              orderId,
              category,
              description: textarea.value.trim(),
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            appendBubble(
              data.error || 'Sorry, I could not submit that just now. Please try again.',
              'bot',
            );
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Complaint';
            return;
          }
          const { complaint } = await res.json();
          appendBubble('Your complaint has been submitted.', 'bot');
          appendComplaintConfirmationCard(complaint);
        } catch (err) {
          console.error(err);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Complaint';
        }
      });
      card.appendChild(wrap);
    },
    { wide: true },
  );
}

function appendComplaintConfirmationCard(complaint) {
  const label = COMPLAINT_CATEGORIES.find((c) => c.value === complaint.category)?.label || complaint.category;

  appendCard((card) => {
    const wrap = document.createElement('div');
    wrap.className = 'wa-complaint-confirm';
    wrap.innerHTML = `
      <div class="wa-complaint-confirm-row"><span>Complaint ID</span><strong>${escapeHtml(complaint.id)}</strong></div>
      <div class="wa-complaint-confirm-row"><span>Order</span><strong>${escapeHtml(complaint.orderId)}</strong></div>
      <div class="wa-complaint-confirm-row"><span>Category</span><strong>${escapeHtml(label)}</strong></div>
      <div class="wa-complaint-confirm-row"><span>Status</span><strong>${escapeHtml(complaint.status)}</strong></div>
    `;
    card.appendChild(wrap);
  });
}

function skeletonListHTML(count) {
  return `<div class="order-list">${Array.from({ length: count }, () => '<div class="skeleton-row"></div>').join('')}</div>`;
}

// ---- My orders ----
const ORDER_STATUS_LABELS = {
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const ACTIVE_STATUSES = new Set(['CONFIRMED', 'PREPARING', 'PICKED_UP', 'OUT_FOR_DELIVERY']);

function orderCardHTML(order, currentOrderId) {
  const date = new Date(order.placedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const itemsSummary = order.cart.map((l) => `${l.quantity}× ${l.itemName}`).join(', ');
  const isCurrent = order.id === currentOrderId;

  return `
    <div class="order-card" data-order-id="${escapeHtml(order.id)}">
      <div class="order-card-top">
        <div>
          <div class="order-card-id">${escapeHtml(order.id)}</div>
          <div class="order-card-date">${escapeHtml(date)}</div>
        </div>
        <span class="order-status-pill status-${order.status.toLowerCase()}">${ORDER_STATUS_LABELS[order.status] || order.status}</span>
      </div>
      <div class="order-card-items">${escapeHtml(itemsSummary)}</div>
      <div class="order-card-bottom">
        <span class="order-card-total">${money(order.bill.total)}</span>
      </div>
      <div class="order-card-actions">
        <button type="button" class="order-action-btn" data-action="details" aria-expanded="false">View details</button>
        ${isCurrent ? `<button type="button" class="order-action-btn" data-action="reorder">Reorder</button>` : ''}
        ${isCurrent && ACTIVE_STATUSES.has(order.status) ? `<button type="button" class="order-action-btn" data-action="track">Track order</button>` : ''}
        <button type="button" class="order-action-btn" data-action="report">Report an issue</button>
      </div>
      <div class="order-card-details hidden"></div>
    </div>
  `;
}

function orderCardDetailsHTML(order) {
  return `
    <div class="order-summary-row"><span>Address</span><strong>${escapeHtml(order.address)}</strong></div>
    <div class="order-summary-row"><span>Payment</span><strong>${order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'UPI'}</strong></div>
    ${order.cart
      .map(
        (l) => `
          <div class="order-summary-row">
            <span>${l.quantity}× ${escapeHtml(l.itemName)}</span>
            <span>${money(l.unitPrice * l.quantity)}</span>
          </div>
        `,
      )
      .join('')}
    <div class="order-summary-row"><span>Subtotal</span><span>${money(order.bill.subtotal)}</span></div>
    ${order.bill.discount > 0 ? `<div class="order-summary-row"><span>Discount</span><span>−${money(order.bill.discount)}</span></div>` : ''}
    <div class="order-summary-row"><span>Delivery fee</span><span>${money(order.bill.deliveryFee)}</span></div>
    <div class="order-summary-row"><span>GST</span><span>${money(order.bill.gst)}</span></div>
    <div class="order-summary-row"><span>Total</span><strong>${money(order.bill.total)}</strong></div>
  `;
}

function wireOrderCard(card, order) {
  const detailsBtn = card.querySelector('[data-action="details"]');
  const detailsPanel = card.querySelector('.order-card-details');
  detailsBtn.addEventListener('click', () => {
    const expanding = detailsPanel.classList.contains('hidden');
    if (expanding) {
      detailsPanel.innerHTML = orderCardDetailsHTML(order);
      detailsPanel.classList.remove('hidden');
      detailsBtn.textContent = 'Hide details';
    } else {
      detailsPanel.classList.add('hidden');
      detailsBtn.textContent = 'View details';
    }
    detailsBtn.setAttribute('aria-expanded', String(expanding));
  });

  const reorderBtn = card.querySelector('[data-action="reorder"]');
  if (reorderBtn) {
    reorderBtn.addEventListener('click', () => {
      closeInfoModal();
      sendMessage('REORDER', 'Reorder my last order');
    });
  }

  const trackBtn = card.querySelector('[data-action="track"]');
  if (trackBtn) {
    trackBtn.addEventListener('click', async () => {
      closeInfoModal();
      await appendTrackingCard(order.id, order.status, order.partner);
      startTracking(order.id);
    });
  }

  card.querySelector('[data-action="report"]').addEventListener('click', () => {
    reportIssueForOrder(order.id);
  });
}

async function openMyOrders() {
  openInfoModal('My Orders');

  if (!state.phone) {
    infoBodyEl.innerHTML = '<div class="info-empty">Pick a customer first.</div>';
    return;
  }

  infoBodyEl.innerHTML = skeletonListHTML(3);

  const [ordersRes, currentRes, profileRes] = await Promise.all([
    fetch(`/sim/orders?phone=${encodeURIComponent(state.phone)}`),
    fetch(`/sim/orders/current?phone=${encodeURIComponent(state.phone)}`),
    fetch(`/sim/profile?phone=${encodeURIComponent(state.phone)}`),
  ]);

  const { orders } = await ordersRes.json();
  const { order: currentOrder } = await currentRes.json();
  const profileData = await profileRes.json();
  const currentOrderId = currentOrder ? currentOrder.id : null;

  if (orders.length === 0) {
    infoBodyEl.innerHTML = '<div class="info-empty">No orders yet. Place your first order from the chat!</div>';
    return;
  }

  const groups = [
    ['Active', orders.filter((o) => ACTIVE_STATUSES.has(o.status))],
    ['Delivered', orders.filter((o) => o.status === 'DELIVERED')],
    ['Cancelled', orders.filter((o) => o.status === 'CANCELLED')],
  ];

  let html = '';
  for (const [label, group] of groups) {
    if (group.length === 0) continue;
    html += `<div class="section-label" style="margin-top:10px">${label}</div><div class="order-list">`;
    html += group.map((o) => orderCardHTML(o, currentOrderId)).join('');
    html += '</div>';
  }

  const history = profileData.profile.orderHistory || [];
  if (history.length > 0) {
    html += '<div class="section-label" style="margin-top:14px">Dishes you\'ve rated recently</div>';
    history.slice(0, 8).forEach((h) => {
      html += `
        <div class="order-summary-row">
          <span>${escapeHtml(h.cuisine)}</span>
          <span>${starIcon(11).repeat(h.rating)}</span>
        </div>
      `;
    });
  }

  infoBodyEl.innerHTML = html;

  infoBodyEl.querySelectorAll('.order-card').forEach((card) => {
    const order = orders.find((o) => o.id === card.dataset.orderId);
    wireOrderCard(card, order);
  });
}

// ============================================================
// Switching contacts
// ============================================================
async function switchUser(phone, displayName) {
  closeStream();
  closeAllSheets();
  state.phone = phone;
  state.orderId = null;
  state.itemImageCache = {};
  state.trackingRefs = null;
  transcriptEl.innerHTML = '';
  statusLineEl.textContent = 'online';
  appendWelcomeMenu(displayName);
  await Promise.all([restoreActiveOrder(phone), refreshCartState()]);
}

// ============================================================
// Initial application boot
// ============================================================
async function initApp() {
  try {
    await loadUsers();

    if (!state.users.length) {
      console.warn('No customers available.');
      return;
    }

    const savedPhone = localStorage.getItem('ahaar_phone');

    const savedUser = savedPhone
      ? state.users.find((u) => u.phone === savedPhone)
      : null;

    const initialUser = savedUser || state.users[0];

    await switchUser(initialUser.phone, initialUser.name);
  } catch (err) {
    console.error('Ahaar app initialization failed:', err);
  }
}

initApp();