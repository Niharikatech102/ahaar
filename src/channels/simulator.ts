import { Router, type Request, type Response } from 'express';
import { processMessage } from '../core/engine.js';
import type { SessionStore } from '../core/session.js';
import { getAllUsers } from '../domain/users.js';
import { statusAt } from '../domain/delivery.js';
import { createLogger } from '../logger.js';

const log = createLogger('simulator');
const STREAM_INTERVAL_MS = 2000;

/**
 * Zero-credential channel for the browser demo UI. A message is a plain
 * request/response; delivery status is pushed over Server-Sent Events so
 * the tracker card updates live without polling.
 */
export function createSimulatorRouter(store: SessionStore): Router {
  const router = Router();

  router.get('/users', (_req: Request, res: Response) => {
    const users = getAllUsers().map((u) => ({ phone: u.phone, name: u.name }));
    res.json({ users });
  });

  router.post('/message', (req: Request, res: Response) => {
    const { phone, text } = (req.body ?? {}) as { phone?: unknown; text?: unknown };
    if (typeof phone !== 'string' || !phone.trim() || typeof text !== 'string') {
      res.status(400).json({ error: 'phone and text are required' });
      return;
    }

    const result = processMessage(store, phone, text);
    res.json(result);
  });

  router.get('/orders/:orderId/stream', (req: Request, res: Response) => {
    const { orderId } = req.params;
    const phone = req.query['phone'];
    if (typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({ error: 'phone query parameter is required' });
      return;
    }

    const session = store.get(phone, Date.now());
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
      res.write(`data: ${JSON.stringify({ status })}\n\n`);
      if (status === 'DELIVERED') {
        clearInterval(timer);
        res.end();
      }
    };

    sendUpdate();
    const timer = setInterval(sendUpdate, STREAM_INTERVAL_MS);
    req.on('close', () => {
      clearInterval(timer);
      log.info(`stream closed for ${orderId}`);
    });
  });

  return router;
}
