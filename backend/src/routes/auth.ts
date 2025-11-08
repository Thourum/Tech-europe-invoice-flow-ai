import { Hono } from 'hono';

import { auth } from '../lib/auth';

export const authRoute = new Hono();

authRoute.all('/*', async (c) => {
  const response = await auth.handler(c.req.raw);
  return response;
});

