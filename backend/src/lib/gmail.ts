import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

const STATE_TTL_MS = 15 * 60 * 1000;
const STATE_VERSION = 'v1';

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getRedirectUri() {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${process.env.APP_URL ?? 'http://localhost:3000'}/api/gmail/oauth/callback`
  );
}

function createOAuthClient() {
  return new OAuth2Client({
    clientId: getEnvVar('GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: getEnvVar('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: getRedirectUri()
  });
}

export function createAuthorizedGmailClient(config: {
  accessToken?: string | null;
  refreshToken: string;
  expiresAt?: number | null;
  scope?: string | null;
}) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: config.accessToken ?? undefined,
    refresh_token: config.refreshToken,
    expiry_date: config.expiresAt ?? undefined,
    scope: config.scope ?? undefined
  });
  return client;
}

export function generateGmailAuthUrl(state: string) {
  const client = createOAuthClient();

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return { tokens, client };
}

export async function refreshAccessToken(refreshToken: string) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  client.setCredentials(credentials);
  return { tokens: credentials, client };
}

export async function fetchPrimaryEmail(client: OAuth2Client) {
  const oauth2 = google.oauth2({
    version: 'v2',
    auth: client
  });

  const { data } = await oauth2.userinfo.get();
  return data.email ?? null;
}

export function createGmailState(userId: string) {
  const secret = getEnvVar('BETTER_AUTH_SECRET');
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  const payload = `${STATE_VERSION}:${userId}:${nonce}:${issuedAt}`;
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  const encoded = Buffer.from(`${payload}:${signature}`, 'utf8').toString(
    'base64url'
  );
  return encoded;
}

export function verifyGmailState(state: string) {
  try {
    const secret = getEnvVar('BETTER_AUTH_SECRET');
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 5) {
      return null;
    }
    const [version, userId, nonce, issuedAtRaw, signature] = parts;
    if (version !== STATE_VERSION) {
      return null;
    }
    const payload = `${version}:${userId}:${nonce}:${issuedAtRaw}`;
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest();
    const providedSignature = Buffer.from(signature, 'base64url');
    if (
      expectedSignature.length !== providedSignature.length ||
      !timingSafeEqual(expectedSignature, providedSignature)
    ) {
      return null;
    }
    const issuedAt = Number(issuedAtRaw);
    if (Number.isNaN(issuedAt)) {
      return null;
    }
    if (Date.now() - issuedAt > STATE_TTL_MS) {
      return null;
    }
    return { userId };
  } catch {
    return null;
  }
}

