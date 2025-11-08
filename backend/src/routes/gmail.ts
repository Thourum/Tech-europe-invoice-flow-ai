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
import { logger, type AppEnv } from '../lib/logger';

const gmailCheckSchema = z.object({
  maxResults: z.number().int().positive().max(50).optional(),
  query: z.string().max(512).optional()
});

export const gmailRoute = new Hono<AppEnv>();

gmailRoute.post('/link', async (c) => {
  const log = c.get('logger') ?? logger;
  const session = await getSessionFromRequest(c.req.raw);

  if (!session?.session) {
    log.warn('Attempt to link Gmail without an active session');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  log.trace({ userId: session.user.id }, 'Generating Gmail authorization URL');

  const state = createGmailState(session.user.id);
  const authorizationUrl = generateGmailAuthUrl(state);

  log.trace({ userId: session.user.id }, 'Generated Gmail authorization URL');

  return c.json({
    authorizationUrl,
    state,
    expiresIn: 900
  });
});

gmailRoute.get('/oauth/callback', async (c) => {
  const log = c.get('logger') ?? logger;
  const error = c.req.query('error');
  if (error) {
    log.error({ error }, 'Gmail OAuth callback returned an error');
    return c.json({ error }, 400);
  }

  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  const redirectTarget = c.req.query('redirect');

  log.trace(
    { hasCode: Boolean(code), hasState: Boolean(stateParam), redirectTarget },
    'Handling Gmail OAuth callback'
  );

  if (!code || !stateParam) {
    log.warn('Gmail OAuth callback missing required parameters');
    return c.json({ error: 'Missing authorization parameters' }, 400);
  }

  const state = verifyGmailState(stateParam);
  if (!state) {
    log.warn({ stateParam }, 'Gmail OAuth state verification failed');
    return c.json({ error: 'Invalid or expired state' }, 400);
  }

  const existing = await db.query.gmailCredentials.findFirst({
    where: eq(gmailCredentials.userId, state.userId)
  });

  const { tokens, client } = await exchangeCodeForTokens(code);

  const refreshToken =
    tokens.refresh_token ?? existing?.refreshToken ?? null;

  if (!refreshToken) {
    log.error(
      { userId: state.userId },
      'Gmail OAuth did not return a refresh token'
    );
    return c.json(
      { error: 'Google did not return a refresh token. Try again with consent.' },
      400
    );
  }

  const email = await fetchPrimaryEmail(client);

  if (!email) {
    log.error({ userId: state.userId }, 'Failed to fetch primary Gmail address');
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

  log.trace(
    { userId: state.userId, email },
    'Upserted Gmail credentials'
  );

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
    log.trace(
      { redirectTarget: url.toString() },
      'Redirecting after Gmail OAuth'
    );
    return c.redirect(url.toString());
  }

  log.trace({ email }, 'Returning Gmail OAuth callback response');
  return c.json(responsePayload);
});

gmailRoute.post('/check', async (c) => {
  const log = c.get('logger') ?? logger;
  const session = await getSessionFromRequest(c.req.raw);

  if (!session?.session) {
    log.warn('Attempt to check Gmail messages without an active session');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let rawBody: unknown = {};

  if (c.req.header('content-type')?.includes('application/json')) {
    try {
      rawBody = await c.req.json();
    } catch {
      log.warn('Failed to parse Gmail check request body as JSON');
      rawBody = {};
    }
  }

  let parsedBody: z.infer<typeof gmailCheckSchema>;
  try {
    parsedBody = gmailCheckSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      log.warn({ issues: error.issues }, 'Invalid Gmail check payload');
      return c.json(
        {
          error: 'Invalid request payload',
          issues: error.issues
        },
        400
      );
    }
    log.error({ err: error }, 'Unexpected error validating Gmail check payload');
    throw error;
  }

  const maxResults = parsedBody.maxResults ?? 5;
  const query = parsedBody.query;

  try {
    const messages = await fetchRecentInvoiceMessages(session.user.id, {
      maxResults,
      query
    });

    log.trace(
      { userId: session.user.id, messageCount: messages.length },
      'Fetched recent Gmail messages'
    );

    return c.json({ messages });
  } catch (error) {
    log.error(
      { err: error, userId: session.user.id },
      'Failed to fetch Gmail messages'
    );

    if (error instanceof Error && error.message === 'Gmail account not linked') {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: 'Failed to fetch Gmail messages' }, 500);
  }
});

