import { Hono } from 'hono';

import { authRoute } from './routes/auth';
import { attachmentsRoute } from './routes/attachments';
import { gmailRoute } from './routes/gmail';
import { invoicesRoute } from './routes/invoices';

export function createApp() {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/api/auth', authRoute);
  app.route('/attachments', attachmentsRoute);
  app.route('/integrations/gmail', gmailRoute);
  app.route('/invoices', invoicesRoute);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    console.error('Unhandled application error', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  return app;
}

