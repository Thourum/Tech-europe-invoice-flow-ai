import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

const tursoUrl =
  process.env.TURSO_DATABASE_URL ?? 'file:./local.db';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: tursoUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});

