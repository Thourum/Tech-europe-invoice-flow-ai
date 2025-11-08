import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

import * as schema from './schema';

type Database = LibSQLDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __drizzleDb__: Database | undefined;
}

function createDb(): Database {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is not set');
  }

  const authToken = process.env.TURSO_AUTH_TOKEN;

  const client = createClient({
    url,
    authToken
  });

  return drizzle(client, { schema });
}

export const db: Database = globalThis.__drizzleDb__ ?? createDb();

if (!globalThis.__drizzleDb__) {
  globalThis.__drizzleDb__ = db;
}

export type { Database };

