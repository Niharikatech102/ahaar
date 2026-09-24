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
    const addressResult = await send('1');
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

    const billResult = await send('SKIP');
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
