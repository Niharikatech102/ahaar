const state = {
  phone: null,
  users: [],
  orderId: null,
  eventSource: null,
};

const transcriptEl = document.getElementById('transcript');
const userListEl = document.getElementById('userList');
const composer = document.getElementById('composer');
const textInput = document.getElementById('textInput');
const trackerEl = document.getElementById('orderTracker');
const statusLineEl = document.getElementById('statusLine');

const STEP_ORDER = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const NEW_CUSTOMER = '__new__';

// Deterministic per-phone avatar color, so a contact keeps the same color
// across reloads without hardcoding a palette entry per demo user. Kept
// clear of green - that's the app's own accent color, used for bubbles,
// buttons and the active-row highlight, so avatars need to read as distinct.
const AVATAR_PALETTE = ['#5b6bd6', '#e2725b', '#a1558c', '#c2984f', '#3f7ea6', '#c2555f'];
function avatarColorFor(phone) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = (hash * 31 + phone.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatText(text) {
  return escapeHtml(text)
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function appendBubble(text, sender) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${sender}`;
  bubble.innerHTML = formatText(text);
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function randomGuestPhone() {
  const n = Math.floor(1_000_000 + Math.random() * 8_999_999);
  return `whatsapp:+1999${n}`;
}

function renderUserList() {
  userListEl.innerHTML = '';

  for (const u of state.users) {
    userListEl.appendChild(buildUserRow(u.phone, u.name, 'Has order history', u.phone));
  }
  userListEl.appendChild(buildUserRow(NEW_CUSTOMER, 'New customer', 'No saved history', null));
}

function buildUserRow(key, name, subtitle, phoneForAvatar) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'user-row';
  row.dataset.key = key;
  row.setAttribute('aria-label', `${name}, ${subtitle}`);

  const avatar = document.createElement('span');
  avatar.className = 'user-avatar';
  if (phoneForAvatar) {
    avatar.textContent = name.charAt(0).toUpperCase();
    avatar.style.background = avatarColorFor(phoneForAvatar);
  } else {
    avatar.textContent = '+';
    avatar.classList.add('user-avatar-ghost');
  }

  const meta = document.createElement('span');
  meta.className = 'user-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'user-name';
  nameEl.textContent = name;
  const subEl = document.createElement('span');
  subEl.className = 'user-sub';
  subEl.textContent = subtitle;
  meta.append(nameEl, subEl);

  row.append(avatar, meta);
  row.addEventListener('click', () => selectUserRow(key));
  return row;
}

function setActiveRow(key) {
  userListEl.querySelectorAll('.user-row').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });
}

function selectUserRow(key) {
  if (key === NEW_CUSTOMER) {
    setActiveRow(key);
    switchUser(randomGuestPhone(), null);
    return;
  }
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

function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function switchUser(phone, displayName) {
  closeStream();
  state.phone = phone;
  state.orderId = null;
  transcriptEl.innerHTML = '';
  trackerEl.classList.add('hidden');
  statusLineEl.textContent = 'online';

  appendBubble(
    displayName
      ? `Hi ${displayName.split(' ')[0]}! I'm your food ordering assistant. Tell me what you're craving.`
      : "Hi! I'm your food ordering assistant. Tell me what you're craving.",
    'bot',
  );
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
  try {
    const res = await fetch('/sim/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: state.phone, text }),
    });
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    const data = await res.json();
    for (const reply of data.replies) appendBubble(reply, 'bot');

    if (data.orderId && data.orderId !== state.orderId) {
      state.orderId = data.orderId;
      startTracking(data.orderId);
    }
  } catch (err) {
    appendBubble('Something went wrong reaching the bot. Please try again.', 'bot');
    console.error(err);
  }
}

function updateTrackerUI(status) {
  const currentIndex = STEP_ORDER.indexOf(status);
  document.querySelectorAll('#orderTracker .step').forEach((el) => {
    const stepIndex = STEP_ORDER.indexOf(el.dataset.step);
    el.classList.toggle('done', stepIndex <= currentIndex);
    el.classList.toggle('current', stepIndex === currentIndex);
  });
  statusLineEl.textContent = status === 'DELIVERED' ? 'delivered' : 'order in progress';
}

function startTracking(orderId) {
  closeStream();
  trackerEl.classList.remove('hidden');
  updateTrackerUI('CONFIRMED');

  const url = `/sim/orders/${encodeURIComponent(orderId)}/stream?phone=${encodeURIComponent(state.phone)}`;
  const es = new EventSource(url);
  state.eventSource = es;

  es.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    updateTrackerUI(payload.status);
    if (payload.status === 'DELIVERED') closeStream();
  };
  es.onerror = () => closeStream();
}

async function init() {
  await loadUsers();
  if (state.users.length > 0) {
    selectUserRow(state.users[0].phone);
  }
}

init();
