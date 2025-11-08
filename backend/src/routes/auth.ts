import { Hono } from 'hono';

import { auth } from '../lib/auth';
import { logger, type AppEnv } from '../lib/logger';

export const authRoute = new Hono<AppEnv>();

authRoute.all('/*', async (c) => {
  const log = c.get('logger') ?? logger;
  log.trace({ path: c.req.path }, 'Forwarding auth request');

  const response = await auth.handler(c.req.raw);

  log.trace({ status: response.status }, 'Auth handler responded');

  return response;
});

