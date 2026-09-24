import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { config, isTwilioConfigured, PUBLIC_DIR } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

const startedAt = Date.now();

export function createApp(): Express {
  const app = express();

  // Twilio posts application/x-www-form-urlencoded; the simulator posts JSON.
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, _res, next) => {
    if (req.path !== '/health') log.info(`${req.method} ${req.path}`);
    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      env: config.env,
      channels: {
        simulator: true,
        twilio: isTwilioConfigured() ? 'configured' : 'not-configured',
      },
    });
  });

  app.use(express.static(PUBLIC_DIR));

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'whatsapp-food-bot',
      message: 'Simulator UI is not built yet. Try GET /health.',
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error('unhandled request error', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

export function start(): Server {
  const app = createApp();
  const server = app.listen(config.port, () => {
    log.info(`listening on http://localhost:${config.port}`);
    log.info(`twilio: ${isTwilioConfigured() ? 'configured' : 'not configured (simulator only)'}`);
  });

  const shutdown = (signal: string) => {
    log.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

// Only auto-start when executed directly, so tests can import createApp().
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  start();
}
