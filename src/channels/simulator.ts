import { Router, type Request, type Response } from 'express';
import { processMessage } from '../core/engine.js';
import type { SessionStore } from '../core/session.js';
import { addUser, getAllUsers, isPhoneTaken, isPlausiblePhone, normalizePhone } from '../domain/users.js';
import { deliveryPartnerFor, statusAt } from '../domain/delivery.js';
import { createLogger } from '../logger.js';

const log = createLogger('simulator');
const STREAM_INTERVAL_MS = 2000;

/** Partner is only meaningful once the order has left the restaurant. */
function partnerFor(orderId: string, status: ReturnType<typeof statusAt>) {
  return status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED' ? deliveryPartnerFor(orderId) : null;
}

/**
 * Zero-credential channel for the browser demo UI. A message is a plain
 * request/response; delivery status is pushed over Server-Sent Events so
 * the tracker card updates live without polling.
 */
export function createSimulatorRouter(store: SessionStore): Router {
  const router = Router();

  router.get('/users', async (_req: Request, res: Response) => {
    const allUsers = await getAllUsers();
    res.json({ users: allUsers.map((u) => ({ phone: u.phone, name: u.name })) });
  });

  router.post('/users', async (req: Request, res: Response) => {
    const { name, phone, address } = (req.body ?? {}) as {
      name?: unknown;
      phone?: unknown;
      address?: unknown;
    };
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    let resolvedPhone: string | undefined;
    if (typeof phone === 'string' && phone.trim()) {
      resolvedPhone = normalizePhone(phone);
      if (!isPlausiblePhone(resolvedPhone)) {
        res.status(400).json({ error: 'phone number looks invalid' });
        return;
      }
      if (await isPhoneTaken(resolvedPhone)) {
        res.status(409).json({ error: 'a customer with this phone number already exists' });
        return;
      }
    }

    const addressLine = typeof address === 'string' && address.trim() ? address.trim() : undefined;
    const profile = await addUser(name.trim(), resolvedPhone, addressLine);
    res.status(201).json({ phone: profile.phone, name: profile.name });
  });

  router.get('/orders/current', async (req: Request, res: Response) => {
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }

    const session = await store.get(phone, Date.now());
    if (!session.currentOrder) {
      res.json({ order: null });
      return;
    }

    const status = statusAt(session.currentOrder.placedAt, Date.now());
    res.json({ order: { id: session.currentOrder.id, status, partner: partnerFor(session.currentOrder.id, status) } });
  });

  router.post('/message', async (req: Request, res: Response) => {
    const { phone, text } = (req.body ?? {}) as { phone?: unknown; text?: unknown };
    if (typeof phone !== 'string' || !phone.trim() || typeof text !== 'string') {
      res.status(400).json({ error: 'phone and text are required' });
      return;
    }

    try {
      const result = await processMessage(store, phone, text);
      res.json(result);
    } catch (err) {
      log.error('failed to process message', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/orders/:orderId/stream', async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }

    const session = await store.get(phone, Date.now());
    const order = session.currentOrder;
    if (!order || order.id !== orderId) {
      res.status(404).json({ error: 'no matching order for this phone' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendUpdate = () => {
      const status = statusAt(order.placedAt, Date.now());
      res.write(`data: ${JSON.stringify({ status, partner: partnerFor(order.id, status) })}\n\n`);
      if (status === 'DELIVERED') {
        clearInterval(timer);
        res.end();
      }
    };

    const timer = setInterval(sendUpdate, STREAM_INTERVAL_MS);
    sendUpdate();
    req.on('close', () => {
      clearInterval(timer);
      log.info(`stream closed for ${orderId}`);
    });
  });

  return router;
}
