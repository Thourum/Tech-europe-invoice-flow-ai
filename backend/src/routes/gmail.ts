import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';

import { db } from '../db/client';
import { gmailCredentials } from '../db/schema';
import { fetchRecentInvoiceMessages } from '../lib/gmail-ingest';
import {
  createGmailState,
  exchangeCodeForTokens,
  fetchPrimaryEmail,
  generateGmailAuthUrl,
  verifyGmailState
} from '../lib/gmail';
import { getSessionFromRequest } from '../lib/auth';

const gmailCheckSchema = z.object({
  maxResults: z.number().int().positive().max(50).optional(),
  query: z.string().max(512).optional()
});

export const gmailRoute = new Hono();

gmailRoute.post('/link', async (c) => {
  const session = await getSessionFromRequest(c.req.raw);

  if (!session?.session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const state = createGmailState(session.user.id);
  const authorizationUrl = generateGmailAuthUrl(state);

  return c.json({
    authorizationUrl,
    state,
    expiresIn: 900
  });
});

gmailRoute.get('/oauth/callback', async (c) => {
  const error = c.req.query('error');
  if (error) {
    return c.json({ error }, 400);
  }

  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  const redirectTarget = c.req.query('redirect');

  if (!code || !stateParam) {
    return c.json({ error: 'Missing authorization parameters' }, 400);
  }

  const state = verifyGmailState(stateParam);
  if (!state) {
    return c.json({ error: 'Invalid or expired state' }, 400);
  }

  const existing = await db.query.gmailCredentials.findFirst({
    where: eq(gmailCredentials.userId, state.userId)
  });

  const { tokens, client } = await exchangeCodeForTokens(code);

  const refreshToken =
    tokens.refresh_token ?? existing?.refreshToken ?? null;

  if (!refreshToken) {
    return c.json(
      { error: 'Google did not return a refresh token. Try again with consent.' },
      400
    );
  }

  const email = await fetchPrimaryEmail(client);

  if (!email) {
    return c.json({ error: 'Unable to fetch Google account information' }, 400);
  }

  const now = Date.now();
  const accessToken = tokens.access_token ?? existing?.accessToken ?? null;
  const scope = tokens.scope ?? existing?.scope ?? null;
  const expiresAt = tokens.expiry_date ?? existing?.expiresAt ?? null;

  await db
    .insert(gmailCredentials)
    .values({
      id: existing?.id ?? ulid(),
      userId: state.userId,
      googleAccountEmail: email,
      accessToken,
      refreshToken,
      scope,
      expiresAt,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: gmailCredentials.userId,
      set: {
        googleAccountEmail: email,
        accessToken,
        refreshToken,
        scope,
        expiresAt,
        updatedAt: now
      }
    });

  const responsePayload = {
    success: true,
    email,
    scope,
    expiresAt
  };

  if (redirectTarget) {
    const appUrl =
      process.env.APP_URL ?? 'http://localhost:3000';
    const isRelative = redirectTarget.startsWith('/');
    const url = isRelative
      ? new URL(redirectTarget, appUrl)
      : new URL(appUrl);
    url.searchParams.set('status', 'linked');
    url.searchParams.set('email', email);
    return c.redirect(url.toString());
  }

  return c.json(responsePayload);
});

gmailRoute.post('/check', async (c) => {
  const session = await getSessionFromRequest(c.req.raw);

  if (!session?.session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let rawBody: unknown = {};

  if (c.req.header('content-type')?.includes('application/json')) {
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }
  }

  let parsedBody: z.infer<typeof gmailCheckSchema>;
  try {
    parsedBody = gmailCheckSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: 'Invalid request payload',
          issues: error.issues
        },
        400
      );
    }
    throw error;
  }

  const maxResults = parsedBody.maxResults ?? 5;
  const query = parsedBody.query;

  try {
    const messages = await fetchRecentInvoiceMessages(session.user.id, {
      maxResults,
      query
    });

    return c.json({ messages });
  } catch (error) {
    console.error('Failed to fetch Gmail messages', error);

    if (error instanceof Error && error.message === 'Gmail account not linked') {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: 'Failed to fetch Gmail messages' }, 500);
  }
});

