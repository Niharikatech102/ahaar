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

    await send('1');
    await send('1');
    await send('YES');
    await send('SKIP');
    const confirmResult = await send('CONFIRM');

    expect(confirmResult.orderId).toBeTruthy();
    expect(confirmResult.replies[0]).toContain('Order placed');

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
});
