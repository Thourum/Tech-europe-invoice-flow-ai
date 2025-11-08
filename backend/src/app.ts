import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { authRoute } from './routes/auth';
import { attachmentsRoute } from './routes/attachments';
import { gmailRoute } from './routes/gmail';
import { invoicesRoute } from './routes/invoices';
import { createRequestLogger, logger, type AppEnv } from './lib/logger';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    const requestLog = createRequestLogger({
      requestId,
      method: c.req.method,
      path: c.req.path
    });

    c.set('logger', requestLog);
    requestLog.trace({ event: 'request.start' }, 'Incoming request');

    const start = Date.now();

    try {
      await next();
    } finally {
      const durationMs = Date.now() - start;
      requestLog.trace(
        {
          event: 'request.finish',
          status: c.res.status,
          durationMs
        },
        'Request completed'
      );
    }
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/api/auth', authRoute);
  app.route('/attachments', attachmentsRoute);
  app.route('/integrations/gmail', gmailRoute);
  app.route('/invoices', invoicesRoute);

  app.notFound((c) => {
    const log = c.get('logger') ?? logger;
    log.warn({ path: c.req.path }, 'Route not found');
    return c.json({ error: 'Not found' }, 404);
  });

  app.onError((err, c) => {
    const log = c.get('logger') ?? logger;
    log.error({ err }, 'Unhandled application error');
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  return app;
}

