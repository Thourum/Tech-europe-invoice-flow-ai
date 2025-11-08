import { Hono } from 'hono';

import { attachmentsRoute } from './routes/attachments';
import { invoicesRoute } from './routes/invoices';

export function createApp() {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/attachments', attachmentsRoute);
  app.route('/invoices', invoicesRoute);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    console.error('Unhandled application error', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  return app;
}

