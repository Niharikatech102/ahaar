import { Router, type Request, type Response } from 'express';
import Twilio from 'twilio';
import { processMessage } from '../core/engine.js';
import type { SessionStore } from '../core/session.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('twilio');

function buildWebhookUrl(req: Request): string {
  if (config.publicBaseUrl) {
    return new URL(req.originalUrl, config.publicBaseUrl).toString();
  }
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * WhatsApp Sandbox webhook. Twilio POSTs each inbound message as
 * form-encoded `From`/`Body`; the reply goes back synchronously as TwiML,
 * one <Message> verb per engine reply. Live delivery-status push (as the
 * simulator does over SSE) isn't wired here - on real WhatsApp the user
 * polls with STATUS instead, which avoids running a background sender
 * against Twilio's REST API for what's meant to be a scoped demo.
 */
export function createTwilioRouter(store: SessionStore): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    if (config.twilio.validateSignature) {
      const signature = req.header('X-Twilio-Signature') ?? '';
      const url = buildWebhookUrl(req);
      const valid = Twilio.validateRequest(
        config.twilio.authToken,
        signature,
        url,
        req.body as Record<string, string>,
      );
      if (!valid) {
        log.warn('rejected webhook: invalid Twilio signature');
        res.status(403).send('invalid signature');
        return;
      }
    }

    const body = req.body as { From?: unknown; Body?: unknown };
    const from = body.From;
    const text = body.Body;
    if (typeof from !== 'string' || typeof text !== 'string') {
      res.status(400).send('missing From/Body');
      return;
    }

    log.info(`inbound from ${from}`);

    const twiml = new Twilio.twiml.MessagingResponse();
    try {
      const result = await processMessage(store, from, text);
      for (const reply of result.replies) {
        const cleanReply = reply
          .replace(/\[REC_START\]\n?/g, '')
          .replace(/\[REC_END\]\n?/g, '')
          .replace(/\[CONTENT_START\]\n?/g, '')
          .replace(/\[CONTENT_END\]\n?/g, '')
          .replace(/\[IMG:.+?\]\n?/g, '');
        twiml.message(cleanReply);
      }
    } catch (err) {
      log.error('failed to process message', err);
      twiml.message('Something went wrong on my end - please try again in a moment.');
    }

    res.type('text/xml').send(twiml.toString());
  });

  return router;
}
