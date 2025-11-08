import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client';

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export const auth = betterAuth({
  secret: getEnvVar('BETTER_AUTH_SECRET'),
  url: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  database: drizzleAdapter(db, {
    provider: 'sqlite'
  }),
  emailAndPassword: {
    enabled: true
  }
});

export type Auth = typeof auth;

export async function getSessionFromRequest(request: Request) {
  return auth.api.getSession({
    headers: request.headers,
    asResponse: false as const,
    returnHeaders: false as const
  });
}

