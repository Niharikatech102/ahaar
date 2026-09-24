import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Signature validation is off by default (see .env.example) - this test
  // exercises the webhook the same way local ngrok testing would, without
  // real Twilio credentials.
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

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function postWebhook(fields: Record<string, string>) {
  return fetch(`${baseUrl}/webhook/twilio/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(fields),
  });
}

describe('POST /webhook/twilio/webhook', () => {
  it('rejects a request missing From or Body', async () => {
    const res = await postWebhook({ From: 'whatsapp:+15551230003' });
    expect(res.status).toBe(400);
  });

  it('replies with valid TwiML for an inbound WhatsApp message', async () => {
    const res = await postWebhook({ From: 'whatsapp:+15551230003', Body: 'Veg Biryani' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/xml');
    const xml = await res.text();
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Message>');
    expect(xml).toContain('Veg Biryani');
  });

  it('carries conversation state across turns keyed by the From number', async () => {
    const phone = 'whatsapp:+15551239999';
    await postWebhook({ From: phone, Body: 'Veg Biryani' });
    const res = await postWebhook({ From: phone, Body: '1' });
    const xml = await res.text();
    expect(xml).toContain('How many would you like');
  });
});
