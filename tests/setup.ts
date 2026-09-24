import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The test suite must stay fast, deterministic, and offline. A locally
// configured Groq key in .env should never make automated tests depend on a
// live network call - this runs before any test file imports src/config.ts,
// and process.loadEnvFile() never overrides an already-set variable.
process.env.GROQ_API_KEY = '';

// Tests must never depend on state left over from a previous test run, or
// from manually using `npm run dev` beforehand - sessions and added
// customers both persist to on-disk snapshots for exactly that reason.
// Start every run from a guaranteed-clean slate regardless of what's there.
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
fs.rmSync(path.join(dataDir, 'sessions.json'), { force: true });
fs.rmSync(path.join(dataDir, 'added_users.json'), { force: true });
