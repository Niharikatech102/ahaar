import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves to the package root in both `tsx src/...` (dev) and `node dist/...`
 * (build) runs, since both `src/` and `dist/` sit one level below the root.
 */
export const PROJECT_ROOT = path.resolve(moduleDir, '..');
export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
export const DATA_DIR = path.join(PROJECT_ROOT, 'src', 'data');

const envFile = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(envFile)) {
  // Node's built-in loader - avoids pulling in dotenv for a single call.
  process.loadEnvFile(envFile);
}

function str(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function bool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(key: string, fallback: number): number {
  const parsed = Number.parseInt(str(key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 3000),
  publicBaseUrl: str('PUBLIC_BASE_URL'),
  twilio: {
    accountSid: str('TWILIO_ACCOUNT_SID'),
    authToken: str('TWILIO_AUTH_TOKEN'),
    whatsappFrom: str('TWILIO_WHATSAPP_FROM', 'whatsapp:+14155238886'),
    validateSignature: bool('TWILIO_VALIDATE_SIGNATURE', false),
  },
} as const;

/** True when there are enough credentials to actually reach WhatsApp. */
export function isTwilioConfigured(): boolean {
  return Boolean(config.twilio.accountSid && config.twilio.authToken);
}
