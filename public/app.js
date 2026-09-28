const state = {
  phone: null,
  users: [],
  orderId: null,
  eventSource: null,
  cart: [],
  bill: null,
};

// ---- DOM refs ----
const transcriptEl = document.getElementById('transcript');
const userListEl = document.getElementById('userList');
const composer = document.getElementById('composer');
const textInput = document.getElementById('textInput');
const quickSuggestionsEl = document.getElementById('quickSuggestions');
const statusLineEl = document.getElementById('statusLine');

const newOrderBtn = document.getElementById('newOrderBtn');
const navListEl = document.getElementById('navList');
const promoTeaserEl = document.getElementById('promoTeaser');
const promoTeaserBodyEl = document.getElementById('promoTeaserBody');

const cartItemsEl = document.getElementById('cartItems');
const cartTitleEl = document.getElementById('cartTitle');
const clearCartBtn = document.getElementById('clearCartBtn');
const promoInput = document.getElementById('promoInput');
const applyPromoBtn = document.getElementById('applyPromoBtn');
const bestDiscountBtn = document.getElementById('bestDiscountBtn');
const promoFeedbackEl = document.getElementById('promoFeedback');
const billBreakdownEl = document.getElementById('billBreakdown');
const checkoutBtn = document.getElementById('checkoutBtn');

const trackerEl = document.getElementById('orderTracker');
const trackerOrderIdEl = document.getElementById('trackerOrderId');
const trackerPartnerEl = document.getElementById('trackerPartner');
const trackingEmptyEl = document.getElementById('trackingEmpty');

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

const STEP_ORDER = ['CONFIRMED', 'PREPARING', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
// Must match FOCUS_INPUT_ACTION in src/core/stateMachine.ts exactly.
const FOCUS_INPUT_ACTION = '__focus_input__';

const DEFAULT_SUGGESTIONS = ['Something spicy', 'Vegetarian under ₹300', 'My usual', "What's my total?"];

const AVATAR_PALETTE = ['#5b6bd6', '#e2725b', '#a1558c', '#c2984f', '#3f7ea6', '#c2555f'];
function avatarColorFor(phone) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = (hash * 31 + phone.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n) {
  return `₹${n}`;
}

// ============================================================
// Chat transcript
// ============================================================
function formatText(text) {
  return escapeHtml(text)
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function appendBubble(text, sender, quickReplies) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${sender}`;
  bubble.innerHTML = formatText(text);
  if (quickReplies && quickReplies.length > 0) {
    bubble.appendChild(buildQuickReplies(quickReplies));
  }
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return bubble;
}

function buildQuickReplies(quickReplies) {
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';
  quickReplies.forEach((qr, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'bubble-action-btn primary' : 'bubble-action-btn';
    btn.textContent = qr.label;
    btn.addEventListener('click', () => {
      if (qr.value === FOCUS_INPUT_ACTION) {
        textInput.focus();
        return;
      }
      actions.querySelectorAll('button').forEach((b) => (b.disabled = true));
      actions.classList.add('resolved');
      sendMessage(qr.value);
    });
    actions.appendChild(btn);
  });
  return actions;
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.innerHTML = '<span></span><span></span><span></span>';
  transcriptEl.appendChild(el);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return el;
}

// A real signal already computed server-side, just labeled for the card -
// never an invented reason.
function badgeFor(rec) {
  const reason = rec.reason.toLowerCase();
  if (reason.includes('ordered')) return 'For you';
  if (rec.entry.restaurant.rating >= 4.7) return 'Highly rated';
  if (rec.entry.restaurant.etaMinutes <= 20) return 'Fastest';
  return null;
}

function buildRecommendationCards(recommendations) {
  const grid = document.createElement('div');
  grid.className = 'rec-grid';

  recommendations.forEach((rec) => {
    const { entry, reason } = rec;
    const badge = badgeFor(rec);
    const reasonParts = reason.split(' · ').filter((p) => !/★|min$/.test(p));

    const card = document.createElement('div');
    card.className = 'rec-card';
    card.innerHTML = `
      <div class="rec-card-media">
        ${entry.item.image ? `<img src="${entry.item.image}" alt="" loading="lazy">` : ''}
        ${badge ? `<span class="rec-badge">${escapeHtml(badge)}</span>` : ''}
      </div>
      <div class="rec-card-body">
        <div class="rec-card-name">${escapeHtml(entry.item.name)} ${entry.item.veg ? '🟢' : '🔴'}</div>
        <div class="rec-card-meta">⭐ ${entry.restaurant.rating.toFixed(1)} · <span class="rec-card-price">${money(entry.item.price)}</span> · ${entry.restaurant.etaMinutes} min</div>
        <ul class="rec-card-reasons">${reasonParts.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
      </div>
      <div class="rec-card-actions">
        <button type="button" class="rec-card-details">Details</button>
        <button type="button" class="rec-card-add">Add to cart</button>
      </div>
    `;
    card.querySelector('.rec-card-details').addEventListener('click', () => openFoodDetail(entry));
    card.querySelector('.rec-card-add').addEventListener('click', (e) => {
      addToCart(entry.restaurant.id, entry.item.id, 1, e.currentTarget);
    });
    grid.appendChild(card);
  });

  return grid;
}

function appendRecommendations(recommendations) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble bot';
  const intro = document.createElement('div');
  intro.textContent = `Here are ${recommendations.length === 3 ? 'my top 3 picks' : 'the best matches I found'}:`;
  bubble.appendChild(intro);
  bubble.appendChild(buildRecommendationCards(recommendations));
  const hint = document.createElement('div');
  hint.style.marginTop = '10px';
  hint.style.fontSize = '12px';
  hint.style.color = 'var(--ink-soft)';
  hint.textContent = 'Tap a card, or reply with a number.';
  bubble.appendChild(hint);
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = '';
  sendMessage(text);
});

async function sendMessage(text) {
  appendBubble(text, 'user');
  quickSuggestionsEl.innerHTML = '';
  const typingEl = showTyping();
  try {
    const res = await fetch('/sim/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: state.phone, text }),
    });
    typingEl.remove();
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    const data = await res.json();

    if (data.recommendations && data.recommendations.length > 0) {
      appendRecommendations(data.recommendations);
    } else {
      data.replies.forEach((reply, i) => {
        const isLast = i === data.replies.length - 1;
        appendBubble(reply, 'bot', isLast ? data.quickReplies : null);
      });
    }

    if (data.orderId && data.orderId !== state.orderId) {
      state.orderId = data.orderId;
      startTracking(data.orderId);
    }
    await loadCart();
  } catch (err) {
    typingEl.remove();
    appendBubble('Something went wrong reaching the bot. Please try again.', 'bot');
    console.error(err);
  }
}

function renderQuickSuggestions() {
  quickSuggestionsEl.innerHTML = '';
  DEFAULT_SUGGESTIONS.forEach((label) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = label;
    chip.addEventListener('click', () => sendMessage(label));
    quickSuggestionsEl.appendChild(chip);
  });
}

// ============================================================
// Sidebar: contacts + nav
// ============================================================
function renderUserList() {
  userListEl.innerHTML = '';
  for (const u of state.users) {
    userListEl.appendChild(buildUserRow(u.phone, u.name));
  }
  userListEl.appendChild(buildAddUserRow());
}

function buildAddUserRow() {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'user-row add-user-row';
  row.setAttribute('aria-label', 'Add a new customer');
  row.innerHTML = `<span class="user-avatar user-avatar-ghost">+</span><span class="user-meta"><span class="user-name">Add new customer</span></span>`;
  row.addEventListener('click', openAddUserModal);
  return row;
}

function buildUserRow(phone, name) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'user-row';
  row.dataset.key = phone;
  row.setAttribute('aria-label', name);
  row.innerHTML = `
    <span class="user-avatar" style="background:${avatarColorFor(phone)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
    <span class="user-meta"><span class="user-name">${escapeHtml(name)}</span></span>
  `;
  row.addEventListener('click', () => selectUserRow(phone));
  return row;
}

function setActiveRow(key) {
  userListEl.querySelectorAll('.user-row').forEach((el) => el.classList.toggle('active', el.dataset.key === key));
}

function selectUserRow(key) {
  const user = state.users.find((u) => u.phone === key);
  setActiveRow(key);
  switchUser(key, user ? user.name : null);
}

async function loadUsers() {
  const res = await fetch('/sim/users');
  const data = await res.json();
  state.users = data.users;
  renderUserList();
}

newOrderBtn.addEventListener('click', () => {
  if (!state.phone) return;
  closeAllPanels();
  sendMessage('MENU');
});

navListEl.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => openNav(btn.dataset.nav));
});
promoTeaserEl.addEventListener('click', () => openNav('promos'));

function setActiveNav(key) {
  navListEl.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.nav === key));
}

function openNav(key) {
  setActiveNav(key);
  if (key === 'chat') {
    closeAllPanels();
    return;
  }
  if (key === 'browse') return openBrowseMenu();
  if (key === 'orders') return openMyOrders();
  if (key === 'preferences') return openPreferences();
  if (key === 'promos') return openPromoCodes();
}

function closeAllPanels() {
  addUserOverlay.classList.add('hidden');
  preferencesOverlay.classList.add('hidden');
  infoOverlay.classList.add('hidden');
  setActiveNav('chat');
}

// ============================================================
// Add customer modal
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
addUserClose.addEventListener('click', closeAddUserModal);
addUserCancel.addEventListener('click', closeAddUserModal);
addUserOverlay.addEventListener('click', (e) => {
  if (e.target === addUserOverlay) closeAddUserModal();
});

addUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = newUserNameInput.value.trim();
  if (!name) return;
  const payload = { name };
  const phone = newUserPhoneInput.value.trim();
  if (phone) payload.phone = phone;
  const address = newUserAddressInput.value.trim();
  if (address) payload.address = address;

  const res = await fetch('/sim/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    addUserErrorEl.textContent = data.error || 'Could not add this customer. Please try again.';
    addUserErrorEl.classList.remove('hidden');
    return;
  }

  const newUser = await res.json();
  closeAddUserModal();
  await loadUsers();
  setActiveRow(newUser.phone);
  switchUser(newUser.phone, newUser.name);
});

// ============================================================
// Preferences modal
// ============================================================
async function openPreferences() {
  if (!state.phone) return;
  preferencesErrorEl.classList.add('hidden');
  try {
    const res = await fetch(`/sim/profile?phone=${encodeURIComponent(state.phone)}`);
    const data = await res.json();
    const prefs = data.profile.preferences || {};
    prefCuisines.value = (prefs.cuisines || []).join(', ');
    prefDietary.value = prefs.dietary || '';
    prefSpice.value = prefs.spiceLevel || '';
    prefBudget.value = prefs.budgetMax || '';
  } catch (err) {
    console.error(err);
  }
  preferencesOverlay.classList.remove('hidden');
}
function closePreferences() {
  preferencesOverlay.classList.add('hidden');
  setActiveNav('chat');
}
preferencesClose.addEventListener('click', closePreferences);
preferencesCancel.addEventListener('click', closePreferences);
preferencesOverlay.addEventListener('click', (e) => {
  if (e.target === preferencesOverlay) closePreferences();
});

preferencesForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const cuisines = prefCuisines.value
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const preferences = {
    cuisines,
    dietary: prefDietary.value || null,
    spiceLevel: prefSpice.value || null,
    budgetMax: prefBudget.value ? Number(prefBudget.value) : null,
  };

  const res = await fetch('/sim/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: state.phone, preferences }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    preferencesErrorEl.textContent = data.error || 'Could not save your preferences.';
    preferencesErrorEl.classList.remove('hidden');
    return;
  }
  closePreferences();
  appendBubble("Saved your preferences — I'll factor them into your recommendations from now on.", 'bot');
});

// ============================================================
// Generic info modal: Browse menu / My orders / Promo codes / Food detail
// ============================================================
function openInfoModal(title, { withSearch } = {}) {
  infoTitleEl.textContent = title;
  infoSearchEl.classList.toggle('hidden', !withSearch);
  infoBodyEl.innerHTML = '';
  infoOverlay.classList.remove('hidden');
}
function closeInfoModal() {
  infoOverlay.classList.add('hidden');
  setActiveNav('chat');
}
infoClose.addEventListener('click', closeInfoModal);
infoOverlay.addEventListener('click', (e) => {
  if (e.target === infoOverlay) closeInfoModal();
});

// ---- Browse menu ----
async function openBrowseMenu() {
  openInfoModal('Browse menu', { withSearch: true });
  infoSearchInput.value = '';
  await renderBrowseResults();
  infoSearchInput.oninput = debounce(renderBrowseResults, 250);
}

let browseRestaurants = null;
async function renderBrowseResults() {
  const query = infoSearchInput.value.trim();
  let entries = [];
  if (query) {
    const res = await fetch(`/sim/catalog?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    entries = data.entries;
  } else {
    if (!browseRestaurants) {
      const res = await fetch('/sim/catalog');
      const data = await res.json();
      browseRestaurants = data.restaurants;
    }
    entries = browseRestaurants.flatMap((r) => r.items.map((item) => ({ restaurant: r, item })));
  }

  if (entries.length === 0) {
    infoBodyEl.innerHTML = '<div class="info-empty">No dishes match that search.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'browse-grid';
  entries.slice(0, 60).forEach(({ restaurant, item }) => {
    const card = document.createElement('div');
    card.className = 'browse-card';
    card.innerHTML = `
      ${item.image ? `<img src="${item.image}" alt="" loading="lazy">` : '<div style="aspect-ratio:4/3;background:var(--green-soft)"></div>'}
      <div class="browse-card-body">
        <div class="browse-card-name">${escapeHtml(item.name)} ${item.veg ? '🟢' : '🔴'}</div>
        <div class="browse-card-meta">${money(item.price)} · ⭐ ${restaurant.rating.toFixed(1)}</div>
      </div>
    `;
    card.addEventListener('click', () => openFoodDetail({ restaurant, item }));
    grid.appendChild(card);
  });
  infoBodyEl.innerHTML = '';
  infoBodyEl.appendChild(grid);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- Food detail ----
function openFoodDetail(entry) {
  const { restaurant, item } = entry;
  openInfoModal(item.name);
  infoBodyEl.innerHTML = `
    ${item.image ? `<img class="detail-image" src="${item.image}" alt="">` : ''}
    <div class="detail-name">${escapeHtml(item.name)} ${item.veg ? '🟢' : '🔴'}</div>
    <div class="detail-meta">${restaurant.name} · ⭐ ${restaurant.rating.toFixed(1)} · ${restaurant.etaMinutes} min · ${money(item.price)}</div>
    <div class="detail-tags">${item.tags.map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`).join('')}</div>
    <button type="button" class="modal-btn primary" id="detailAddBtn" style="width:100%">Add to cart</button>
  `;
  document.getElementById('detailAddBtn').addEventListener('click', (e) => {
    addToCart(restaurant.id, item.id, 1, e.currentTarget, () => closeInfoModal());
  });
}

// ---- My orders ----
async function openMyOrders() {
  openInfoModal('My orders');
  if (!state.phone) {
    infoBodyEl.innerHTML = '<div class="info-empty">Pick a customer first.</div>';
    return;
  }
  const [orderRes, profileRes] = await Promise.all([
    fetch(`/sim/orders/current?phone=${encodeURIComponent(state.phone)}`),
    fetch(`/sim/profile?phone=${encodeURIComponent(state.phone)}`),
  ]);
  const orderData = await orderRes.json();
  const profileData = await profileRes.json();

  let html = '';
  if (orderData.order) {
    html += `
      <div class="order-summary-card" style="margin-bottom:16px">
        <div class="order-summary-row"><span>Order</span><strong>${escapeHtml(orderData.order.id)}</strong></div>
        <div class="order-summary-row"><span>Status</span><strong>${escapeHtml(orderData.order.status.replace(/_/g, ' '))}</strong></div>
      </div>
    `;
  } else {
    html += '<div class="info-empty">No order in progress right now.</div>';
  }

  const history = profileData.profile.orderHistory || [];
  if (history.length > 0) {
    html += '<div class="section-label" style="margin-top:6px">Dishes you\'ve rated recently</div>';
    history.slice(0, 8).forEach((h) => {
      html += `<div class="order-summary-row"><span>${escapeHtml(h.cuisine)}</span><span>${'⭐'.repeat(h.rating)}</span></div>`;
    });
  }
  infoBodyEl.innerHTML = html;
}

// ---- Promo codes ----
async function openPromoCodes() {
  openInfoModal('Promo codes');
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
    '<div class="info-empty" style="text-align:left;padding-top:4px">Codes apply automatically once you reach checkout — just ask for "the best discount" and Ahaar will pick the best one for you.</div>',
  );
  loadPromoTeaser(active);
}

async function loadPromoTeaser(preloaded) {
  const active = preloaded || (await fetch('/sim/promos').then((r) => r.json()).then((d) => d.promos.filter((p) => !p.expired)));
  if (active.length === 0) {
    promoTeaserBodyEl.textContent = 'Check back soon for new offers.';
    return;
  }
  const best = active[0];
  promoTeaserBodyEl.textContent = `${best.code} — ${best.description}`;
}

// ============================================================
// Cart panel
// ============================================================
async function loadCart() {
  if (!state.phone) return;
  const res = await fetch(`/sim/cart?phone=${encodeURIComponent(state.phone)}`);
  const data = await res.json();
  state.cart = data.cart;
  state.bill = data.bill;
  renderCart();
}

function renderCart() {
  cartTitleEl.textContent = state.cart.length > 0 ? `Your cart (${state.cart.length})` : 'Your cart';

  syncBestDiscountVisibility();

  if (state.cart.length === 0) {
    cartItemsEl.innerHTML = '<div class="cart-empty">Your cart is empty. Ask Ahaar for something to eat.</div>';
    billBreakdownEl.classList.add('hidden');
    checkoutBtn.disabled = true;
    return;
  }

  cartItemsEl.innerHTML = '';
  state.cart.forEach((line) => {
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(line.itemName)}</div>
        <div class="cart-item-restaurant">${escapeHtml(line.restaurantName)}</div>
        <div class="cart-item-price">${money(line.unitPrice * line.quantity)}</div>
      </div>
      <div class="qty-control">
        <button type="button" class="qty-btn" data-action="dec">−</button>
        <span class="qty-value">${line.quantity}</span>
        <button type="button" class="qty-btn" data-action="inc">+</button>
      </div>
      <button type="button" class="cart-item-remove" aria-label="Remove">🗑</button>
    `;
    row.querySelector('[data-action="dec"]').addEventListener('click', () => changeQuantity(line, line.quantity - 1));
    row.querySelector('[data-action="inc"]').addEventListener('click', () => changeQuantity(line, line.quantity + 1));
    row.querySelector('.cart-item-remove').addEventListener('click', () => removeCartItem(line));
    cartItemsEl.appendChild(row);
  });

  const bill = state.bill;
  billBreakdownEl.classList.remove('hidden');
  billBreakdownEl.innerHTML = `
    <div class="bill-row"><span>Subtotal</span><span>${money(bill.subtotal)}</span></div>
    ${bill.discount > 0 ? `<div class="bill-row discount"><span>Discount${bill.appliedPromoCode ? ` (${escapeHtml(bill.appliedPromoCode)})` : ''}</span><span>−${money(bill.discount)}</span></div>` : ''}
    <div class="bill-row"><span>Delivery fee</span><span>${money(bill.deliveryFee)}</span></div>
    <div class="bill-row"><span>GST</span><span>${money(bill.gst)}</span></div>
    <div class="bill-row total"><span>Total</span><span class="bill-value">${money(bill.total)}</span></div>
  `;
  checkoutBtn.disabled = false;
}

async function addToCart(restaurantId, itemId, quantity, buttonEl, onDone) {
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Adding…';
  }
  try {
    const res = await fetch('/sim/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: state.phone, restaurantId, itemId, quantity }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (buttonEl) {
        buttonEl.textContent = data.error && res.status === 409 ? 'Busy — try again' : 'Unavailable';
      }
      setTimeout(() => {
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = 'Add to cart';
        }
      }, 1400);
      return;
    }
    const data = await res.json();
    state.cart = data.cart;
    state.bill = data.bill;
    renderCart();
    if (buttonEl) {
      buttonEl.textContent = 'Added ✓';
      setTimeout(() => {
        buttonEl.disabled = false;
        buttonEl.textContent = 'Add to cart';
      }, 1100);
    }
    onDone && onDone();
  } catch (err) {
    console.error(err);
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = 'Add to cart';
    }
  }
}

async function changeQuantity(line, newQty) {
  if (newQty < 1) return removeCartItem(line);
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
  renderCart();
}

async function removeCartItem(line) {
  const res = await fetch('/sim/cart/items', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: state.phone, restaurantId: line.restaurantId, itemId: line.itemId }),
  });
  if (!res.ok) return;
  const data = await res.json();
  state.cart = data.cart;
  state.bill = data.bill;
  renderCart();
}

clearCartBtn.addEventListener('click', async () => {
  if (!state.phone || state.cart.length === 0) return;
  const res = await fetch('/sim/cart/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: state.phone }),
  });
  if (!res.ok) return;
  const data = await res.json();
  state.cart = data.cart;
  state.bill = data.bill;
  renderCart();
});

checkoutBtn.addEventListener('click', () => {
  if (checkoutBtn.disabled) return;
  sendMessage('CHECKOUT');
});

applyPromoBtn.addEventListener('click', () => {
  const code = promoInput.value.trim();
  if (!code) return;
  promoInput.value = '';
  sendMessage(code);
});
promoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyPromoBtn.click();
  }
});
bestDiscountBtn.addEventListener('click', () => sendMessage('best discount'));

// Show the best-discount shortcut only once a discount could plausibly apply (non-empty cart).
function syncBestDiscountVisibility() {
  bestDiscountBtn.classList.toggle('hidden', state.cart.length === 0);
}

// ============================================================
// Order tracking
// ============================================================
function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function updateTrackerUI(status, partner, orderId) {
  trackerEl.classList.remove('hidden');
  trackingEmptyEl.classList.add('hidden');
  if (orderId) trackerOrderIdEl.textContent = orderId;

  const currentIndex = STEP_ORDER.indexOf(status);
  trackerEl.querySelectorAll('.step').forEach((el) => {
    const stepIndex = STEP_ORDER.indexOf(el.dataset.step);
    el.classList.toggle('done', stepIndex <= currentIndex);
    el.classList.toggle('current', stepIndex === currentIndex);
  });
  statusLineEl.textContent = status === 'DELIVERED' ? 'delivered' : 'order in progress';

  if (partner) {
    trackerPartnerEl.textContent = `🛵 ${partner.name} is delivering your order (${partner.vehicle})`;
    trackerPartnerEl.classList.remove('hidden');
  } else {
    trackerPartnerEl.classList.add('hidden');
  }
}

function resetTracker() {
  trackerEl.classList.add('hidden');
  trackingEmptyEl.classList.remove('hidden');
  trackerPartnerEl.classList.add('hidden');
}

function startTracking(orderId) {
  closeStream();
  updateTrackerUI('CONFIRMED', null, orderId);

  const url = `/sim/orders/${encodeURIComponent(orderId)}/stream?phone=${encodeURIComponent(state.phone)}`;
  const es = new EventSource(url);
  state.eventSource = es;
  es.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    updateTrackerUI(payload.status, payload.partner, orderId);
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
    startTracking(data.order.id);
    updateTrackerUI(data.order.status, data.order.partner, data.order.id);
  } catch (err) {
    console.error(err);
  }
}

// ============================================================
// Switching contacts
// ============================================================
async function switchUser(phone, displayName) {
  closeStream();
  closeAllPanels();
  state.phone = phone;
  state.orderId = null;
  transcriptEl.innerHTML = '';
  resetTracker();
  statusLineEl.textContent = 'online';

  appendBubble(
    displayName
      ? `Hi ${displayName.split(' ')[0]}! I'm Ahaar, your AI food ordering assistant. Tell me what you're craving today.`
      : "Hi! I'm Ahaar, your AI food ordering assistant. Tell me what you're craving today.",
    'bot',
  );
  renderQuickSuggestions();

  await Promise.all([restoreActiveOrder(phone), loadCart()]);
}

async function init() {
  await Promise.all([loadUsers(), loadPromoTeaser()]);
  if (state.users.length > 0) {
    selectUserRow(state.users[0].phone);
  }
}

init();
