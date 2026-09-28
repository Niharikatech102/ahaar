import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /health', () => {
  it('reports ok with simulator enabled', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.channels.simulator).toBe(true);
  });
});

describe('GET /sim/users', () => {
  it('lists the seeded demo users', async () => {
    const res = await fetch(`${baseUrl}/sim/users`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.users.length).toBeGreaterThanOrEqual(3);
    expect(data.users[0]).toHaveProperty('phone');
    expect(data.users[0]).toHaveProperty('name');
  });
});

describe('POST /sim/message validation', () => {
  it('rejects a request missing phone or text', async () => {
    const res = await fetch(`${baseUrl}/sim/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: 'whatsapp:+15551230001' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /sim/users', () => {
  it('registers a new customer and immediately lists them', async () => {
    const createRes = await fetch(`${baseUrl}/sim/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Customer' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe('Test Customer');
    expect(typeof created.phone).toBe('string');

    const listRes = await fetch(`${baseUrl}/sim/users`);
    const list = await listRes.json();
    expect(list.users.some((u: { phone: string }) => u.phone === created.phone)).toBe(true);
  });

  it('rejects a request with no name', async () => {
    const res = await fetch(`${baseUrl}/sim/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a customer with full details and saves the address as their default', async () => {
    const res = await fetch(`${baseUrl}/sim/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Full Details Customer',
        phone: '98765 12345',
        address: '9 Full Detail Street, Chennai',
      }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.phone).toBe('whatsapp:+919876512345');

    // This customer should now behave like a seeded user - a fresh search
    // and quantity should lead straight to their saved address, not a blank prompt.
    async function send(text: string) {
      const r = await fetch(`${baseUrl}/sim/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: created.phone, text }),
      });
      return r.json();
    }
    await send('Masala Dosa');
    await send('1');
    await send('1');
    const addressPrompt = await send('CHECKOUT');
    expect(addressPrompt.replies[0]).toContain('9 Full Detail Street, Chennai');
  });

  it('rejects a phone number that already belongs to another customer', async () => {
    const first = await fetch(`${baseUrl}/sim/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First Owner', phone: '9000000001' }),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/sim/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second Claimant', phone: '9000000001' }),
    });
    expect(second.status).toBe(409);
  });

  it('rejects a phone number that is obviously not a real number', async () => {
    const res = await fetch(`${baseUrl}/sim/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Phone', phone: 'abc' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /sim/orders/current', () => {
  it('returns null when the phone has no active order', async () => {
    const res = await fetch(`${baseUrl}/sim/orders/current?phone=${encodeURIComponent('whatsapp:+15551230003')}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.order).toBeNull();
  });

  it('returns the active order and its live status once one is placed', async () => {
    const phone = 'whatsapp:+15551230088';
    async function send(text: string) {
      const res = await fetch(`${baseUrl}/sim/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, text }),
      });
      return res.json();
    }

    await send('Masala Dosa');
    await send('1');
    await send('1');
    await send('CHECKOUT');
    await send('YES');
    await send('SKIP');
    await send('COD');
    const confirmResult = await send('CONFIRM');

    const res = await fetch(`${baseUrl}/sim/orders/current?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    expect(data.order.id).toBe(confirmResult.orderId);
    expect(data.order.status).toBe('CONFIRMED');
  });

  it('rejects a request with no phone', async () => {
    const res = await fetch(`${baseUrl}/sim/orders/current`);
    expect(res.status).toBe(400);
  });
});

describe('full order flow over HTTP', () => {
  const phone = 'whatsapp:+15551230002'; // Meera - has south indian / dessert history

  async function send(text: string) {
    const res = await fetch(`${baseUrl}/sim/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, text }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('walks search through confirmation and opens a live status stream', async () => {
    const searchResult = await send('Masala Dosa');
    expect(searchResult.replies[0]).toContain('top');
    expect(searchResult.orderId).toBeNull();
    expect(searchResult.quickReplies).toBeNull();

    await send('1');
    const addedResult = await send('1');
    expect(addedResult.replies[0]).toContain('Added');

    const addressResult = await send('CHECKOUT');
    expect(addressResult.quickReplies).toEqual([
      { label: 'Yes, deliver here', value: 'YES' },
      { label: 'Use a different address', value: '__focus_input__' },
    ]);

    // Masala Dosa x1 = Rs120 subtotal - below every promo's minimum order
    // value, so no suggestion exists and only See all offers + Skip show.
    const promoResult = await send('YES');
    expect(promoResult.quickReplies).toEqual([
      { label: 'See all offers', value: 'CODES' },
      { label: 'Skip', value: 'SKIP' },
    ]);

    const paymentPromptResult = await send('SKIP');
    expect(paymentPromptResult.quickReplies).toEqual([
      { label: 'Cash on Delivery', value: 'COD' },
      { label: 'UPI', value: 'UPI' },
    ]);

    const billResult = await send('COD');
    expect(billResult.quickReplies).toEqual([
      { label: 'Yes, place order', value: 'CONFIRM' },
      { label: 'No, cancel', value: 'CANCEL' },
    ]);

    const confirmResult = await send('CONFIRM');

    expect(confirmResult.orderId).toBeTruthy();
    expect(confirmResult.replies[0]).toContain('Order placed');
    expect(confirmResult.quickReplies).toBeNull();

    const streamRes = await fetch(
      `${baseUrl}/sim/orders/${confirmResult.orderId}/stream?phone=${encodeURIComponent(phone)}`,
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream');

    const reader = streamRes.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('data:');
    expect(chunk).toContain('CONFIRMED');
    await reader.cancel();
  });

  it('returns 404 for a status stream on an order that does not belong to this phone', async () => {
    const res = await fetch(
      `${baseUrl}/sim/orders/ORD-NOTREAL/stream?phone=${encodeURIComponent(phone)}`,
    );
    expect(res.status).toBe(404);
  });

  it('the CANCEL quick reply aborts the order instead of placing it', async () => {
    // A phone with no prior activity in this suite, so there's no leftover
    // currentOrder from another test to confuse the "was nothing placed" assertion.
    const cancelPhone = 'whatsapp:+15551230077';
    async function sendAs(text: string) {
      const res = await fetch(`${baseUrl}/sim/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cancelPhone, text }),
      });
      expect(res.status).toBe(200);
      return res.json();
    }

    await sendAs('Masala Dosa');
    await sendAs('1');
    await sendAs('1');
    await sendAs('CHECKOUT');
    await sendAs('YES');
    await sendAs('SKIP');

    const cancelResult = await sendAs('CANCEL');
    expect(cancelResult.orderId).toBeNull();
    expect(cancelResult.quickReplies).toBeNull();
    expect(cancelResult.replies[0]).toMatch(/cancelled/i);
  });

  it('offers an Apply button naming the suggested code when one is eligible', async () => {
    const aryanPhone = 'whatsapp:+15551230001';
    async function sendAs(text: string) {
      const res = await fetch(`${baseUrl}/sim/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: aryanPhone, text }),
      });
      expect(res.status).toBe(200);
      return res.json();
    }

    await sendAs('Veg Biryani');
    await sendAs('1'); // Nawab's Kitchen Veg Biryani, Rs260
    await sendAs('2'); // qty 2 -> Rs520 subtotal, crosses MEGA100's Rs500 minimum
    await sendAs('CHECKOUT');
    const promoResult = await sendAs('YES');

    expect(promoResult.quickReplies).toEqual([
      { label: 'Apply MEGA100', value: 'APPLY' },
      { label: 'See all offers', value: 'CODES' },
      { label: 'Skip', value: 'SKIP' },
    ]);

    // CODES lists every eligible promo, not just the single best one -
    // for this Rs520 order that's MEGA100, BIRYANI20 and FLAT50, in that
    // discount order, while OLD25 (expired) and WELCOME50 (first-order-only,
    // and Aryan has history) correctly stay off the list.
    const codesResult = await sendAs('CODES');
    expect(codesResult.replies[0]).toContain('MEGA100');
    expect(codesResult.replies[0]).toContain('BIRYANI20');
    expect(codesResult.replies[0]).toContain('FLAT50');
    expect(codesResult.replies[0]).not.toContain('OLD25');
    expect(codesResult.replies[0]).not.toContain('WELCOME50');
    expect(codesResult.replies[0].indexOf('MEGA100')).toBeLessThan(codesResult.replies[0].indexOf('BIRYANI20'));
    expect(codesResult.replies[0].indexOf('BIRYANI20')).toBeLessThan(codesResult.replies[0].indexOf('FLAT50'));
  });
});

describe('cart REST API (right-panel button edits, not chat messages)', () => {
  const phone = 'whatsapp:+15551230033';

  it('adds, updates, and removes a line without ever trusting client-sent price', async () => {
    const addRes = await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A malicious/buggy client sending a fake price must not affect the bill.
      body: JSON.stringify({ phone, restaurantId: 'r01', itemId: 'i0101', quantity: 1, unitPrice: 1 }),
    });
    expect(addRes.status).toBe(200);
    const added = await addRes.json();
    expect(added.cart).toEqual([
      { restaurantId: 'r01', restaurantName: 'Biryani House', itemId: 'i0101', itemName: 'Veg Biryani', unitPrice: 220, quantity: 1 },
    ]);
    expect(added.bill.subtotal).toBe(220);

    const patchRes = await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, restaurantId: 'r01', itemId: 'i0101', quantity: 3 }),
    });
    const updated = await patchRes.json();
    expect(updated.cart[0].quantity).toBe(3);
    expect(updated.bill.subtotal).toBe(660);

    const deleteRes = await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, restaurantId: 'r01', itemId: 'i0101' }),
    });
    const removed = await deleteRes.json();
    expect(removed.cart).toEqual([]);
  });

  it('adding the same dish twice merges quantity instead of duplicating the line', async () => {
    const uniquePhone = 'whatsapp:+15551230034';
    const add = () =>
      fetch(`${baseUrl}/sim/cart/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, restaurantId: 'r01', itemId: 'i0101', quantity: 1 }),
      }).then((r) => r.json());

    await add();
    const second = await add();
    expect(second.cart).toHaveLength(1);
    expect(second.cart[0].quantity).toBe(2);
  });

  it('rejects a dish id that does not exist in the catalog', async () => {
    const res = await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: 'whatsapp:+15551230035', restaurantId: 'r01', itemId: 'not-a-real-item' }),
    });
    expect(res.status).toBe(404);
  });

  it('refuses to edit the cart while a real conversation step (not just a fresh search) is in progress', async () => {
    // AWAITING_SELECTION is deliberately allowed (that's exactly the state a
    // recommendation card's "Add to Cart" button fires from) - AWAITING_QUANTITY
    // is a genuine mid-flow step and must still be rejected.
    const busyPhone = 'whatsapp:+15551230036';
    async function send(text: string) {
      return fetch(`${baseUrl}/sim/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: busyPhone, text }),
      });
    }
    await send('Masala Dosa');
    await send('1'); // now AWAITING_QUANTITY

    const res = await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: busyPhone, restaurantId: 'r01', itemId: 'i0101' }),
    });
    expect(res.status).toBe(409);
  });

  it('allows adding from a recommendation card while AWAITING_SELECTION, and resolves the pending selection', async () => {
    const cardPhone = 'whatsapp:+15551230038';
    await fetch(`${baseUrl}/sim/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cardPhone, text: 'Masala Dosa' }),
    });

    const res = await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cardPhone, restaurantId: 'r01', itemId: 'i0101' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cart).toHaveLength(1);

    // Typing a plain number now should not be misread as picking 1/2/3 from the old search.
    const nextRes = await fetch(`${baseUrl}/sim/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cardPhone, text: 'CART' }),
    });
    const nextData = await nextRes.json();
    expect(nextData.replies[0]).toContain('Veg Biryani');
  });

  it('GET /sim/cart and POST /sim/cart/clear reflect the same state', async () => {
    const clearPhone = 'whatsapp:+15551230037';
    await fetch(`${baseUrl}/sim/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clearPhone, restaurantId: 'r01', itemId: 'i0101' }),
    });

    const getRes = await fetch(`${baseUrl}/sim/cart?phone=${encodeURIComponent(clearPhone)}`);
    const gotten = await getRes.json();
    expect(gotten.cart).toHaveLength(1);

    const clearRes = await fetch(`${baseUrl}/sim/cart/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clearPhone }),
    });
    const cleared = await clearRes.json();
    expect(cleared.cart).toEqual([]);
  });
});

describe('GET /sim/promos', () => {
  it('lists real promo data from the backend', async () => {
    const res = await fetch(`${baseUrl}/sim/promos`);
    const data = await res.json();
    expect(data.promos.some((p: { code: string }) => p.code === 'MEGA100')).toBe(true);
  });
});

describe('GET /sim/catalog', () => {
  it('returns the full restaurant catalog with no query', async () => {
    const res = await fetch(`${baseUrl}/sim/catalog`);
    const data = await res.json();
    expect(data.restaurants.length).toBeGreaterThan(10);
  });

  it('returns matching entries for a query', async () => {
    const res = await fetch(`${baseUrl}/sim/catalog?q=biryani`);
    const data = await res.json();
    expect(data.entries.length).toBeGreaterThan(0);
    for (const entry of data.entries) {
      expect(entry.restaurant.rating).toBeGreaterThanOrEqual(4.0);
    }
  });
});
