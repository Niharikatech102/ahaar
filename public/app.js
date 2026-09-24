const state = {
  phone: null,
  users: [],
  orderId: null,
  eventSource: null,
};

const transcriptEl = document.getElementById('transcript');
const userSelect = document.getElementById('userSelect');
const userHintEl = document.getElementById('userHint');
const composer = document.getElementById('composer');
const textInput = document.getElementById('textInput');
const quickActionsEl = document.getElementById('quickActions');
const trackerEl = document.getElementById('orderTracker');
const statusLineEl = document.getElementById('statusLine');

const QUICK_ACTIONS = ['Veg Biryani', '1', '2', 'YES', 'SKIP', 'CONFIRM', 'STATUS', 'MENU', 'HELP'];
const STEP_ORDER = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];

function renderQuickActions() {
  quickActionsEl.innerHTML = '';
  for (const label of QUICK_ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-chip';
    btn.textContent = label;
    btn.addEventListener('click', () => sendMessage(label));
    quickActionsEl.appendChild(btn);
  }
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

async function loadUsers() {
  const res = await fetch('/sim/users');
  const data = await res.json();
  state.users = data.users;

  userSelect.innerHTML = '';
  for (const u of state.users) {
    const opt = document.createElement('option');
    opt.value = u.phone;
    opt.textContent = `${u.name} (has order history)`;
    userSelect.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__new__';
  customOpt.textContent = 'New customer (no history)';
  userSelect.appendChild(customOpt);
}

function randomGuestPhone() {
  const n = Math.floor(1_000_000 + Math.random() * 8_999_999);
  return `whatsapp:+1999${n}`;
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
  userHintEl.textContent = displayName
    ? `Chatting as ${displayName} · ${phone.replace('whatsapp:', '')}`
    : `New number, no saved history · ${phone.replace('whatsapp:', '')}`;

  appendBubble(
    displayName
      ? `Hi ${displayName.split(' ')[0]}! I'm your food ordering assistant. Tell me what you're craving.`
      : "Hi! I'm your food ordering assistant. Tell me what you're craving.",
    'bot',
  );
}

userSelect.addEventListener('change', () => {
  const value = userSelect.value;
  if (value === '__new__') {
    switchUser(randomGuestPhone(), null);
    return;
  }
  const user = state.users.find((u) => u.phone === value);
  switchUser(value, user ? user.name : null);
});

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
  renderQuickActions();
  await loadUsers();
  if (state.users.length > 0) {
    userSelect.value = state.users[0].phone;
    switchUser(state.users[0].phone, state.users[0].name);
  }
}

init();
