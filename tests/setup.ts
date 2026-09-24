import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The test suite must stay fast, deterministic, and offline. A locally
// configured Groq key in .env should never make automated tests depend on a
// live network call - this runs before any test file imports src/config.ts,
// and process.loadEnvFile() never overrides an already-set variable.
process.env.GROQ_API_KEY = '';

// Tests must never depend on session state left over from a previous test
// run, or from manually using `npm run dev` beforehand - both persist to
// the same on-disk snapshot (SessionStore's default `persist: true`).
// Start every run from a guaranteed-clean slate regardless of what's there.
const sessionsFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'data',
  'sessions.json',
);
fs.rmSync(sessionsFile, { force: true });
