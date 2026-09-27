import { defineConfig } from 'drizzle-kit';
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set - add it to .env before running drizzle-kit');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
