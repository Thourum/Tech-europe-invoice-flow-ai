import type { OAuth2Client } from 'google-auth-library';
import { gmail_v1, google } from 'googleapis';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import {
  gmailCredentials,
  type GmailCredential
} from '../db/schema';
import {
  createAuthorizedGmailClient,
  refreshAccessToken
} from './gmail';

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif'
]);

const SUPPORTED_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'heic',
  'heif'
]);

export type GmailAttachmentSummary = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size?: number;
  partId?: string;
};

export type GmailMessageSummary = {
  id: string;
  threadId?: string;
  historyId?: string;
  snippet?: string;
  subject?: string | null;
  from?: string | null;
  receivedAt?: number;
  attachmentCount: number;
  attachments: GmailAttachmentSummary[];
};

type RefreshResult = {
  credential: GmailCredential;
  client: OAuth2Client;
};

async function ensureAuthorizedGmailClient(
  credential: GmailCredential
): Promise<RefreshResult> {
  const needsRefresh =
    !credential.accessToken ||
    !credential.expiresAt ||
    credential.expiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS <= Date.now();

  if (!needsRefresh) {
    const client = createAuthorizedGmailClient({
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      expiresAt: credential.expiresAt,
      scope: credential.scope
    });
    return { credential, client };
  }

  const { tokens, client } = await refreshAccessToken(
    credential.refreshToken
  );

  const accessToken = tokens.access_token ?? credential.accessToken ?? null;
  const expiresAt = tokens.expiry_date ?? credential.expiresAt ?? null;
  const scope = tokens.scope ?? credential.scope ?? null;

  const refreshedCredential: GmailCredential = {
    ...credential,
    accessToken,
    expiresAt,
    scope
  };

  await db
    .update(gmailCredentials)
    .set({
      accessToken,
      expiresAt,
      scope,
      updatedAt: Date.now()
    })
    .where(eq(gmailCredentials.id, credential.id));

  return {
    credential: refreshedCredential,
    client
  };
}

function extractHeader(
  payload: gmail_v1.Schema$MessagePart | undefined,
  name: string
) {
  if (!payload?.headers) {
    return null;
  }

  const header = payload.headers.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase()
  );

  return header?.value ?? null;
}

function isSupportedAttachment(
  mimeType: string | undefined | null,
  filename: string | undefined | null
) {
  if (!mimeType && !filename) {
    return false;
  }

  if (mimeType && SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return true;
  }

  if (filename) {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension && SUPPORTED_EXTENSIONS.has(extension)) {
      return true;
    }
  }

  return false;
}

function collectAttachments(
  part: gmail_v1.Schema$MessagePart | undefined,
  accumulator: GmailAttachmentSummary[]
) {
  if (!part) {
    return accumulator;
  }

  if (
    part.body?.attachmentId &&
    isSupportedAttachment(part.mimeType, part.filename)
  ) {
    accumulator.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename ?? 'attachment',
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body.size ?? undefined,
      partId: part.partId ?? undefined
    });
  }

  if (part.parts) {
    for (const nested of part.parts) {
      collectAttachments(nested, accumulator);
    }
  }

  return accumulator;
}

function transformMessage(
  message: gmail_v1.Schema$Message
): GmailMessageSummary {
  const receivedAt = message.internalDate
    ? Number(message.internalDate)
    : undefined;
  const attachments = collectAttachments(message.payload, []);

  return {
    id: message.id ?? 'unknown',
    threadId: message.threadId ?? undefined,
    historyId: message.historyId ?? undefined,
    snippet: message.snippet ?? undefined,
    subject: extractHeader(message.payload, 'subject'),
    from: extractHeader(message.payload, 'from'),
    receivedAt: Number.isNaN(receivedAt) ? undefined : receivedAt,
    attachmentCount: attachments.length,
    attachments
  };
}

export async function fetchRecentInvoiceMessages(
  userId: string,
  options?: {
    maxResults?: number;
    query?: string;
  }
) {
  const credential = await db.query.gmailCredentials.findFirst({
    where: eq(gmailCredentials.userId, userId)
  });

  if (!credential) {
    throw new Error('Gmail account not linked');
  }

  const { client } = await ensureAuthorizedGmailClient(credential);

  const gmail = google.gmail({ version: 'v1', auth: client });

  const query =
    options?.query ??
    'has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg OR filename:heic OR filename:heif)';

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    maxResults: options?.maxResults ?? 10,
    q: query
  });

  const messages = listResponse.data.messages ?? [];

  if (messages.length === 0) {
    return [];
  }

  const results: GmailMessageSummary[] = [];

  for (const ref of messages) {
    if (!ref.id) {
      continue;
    }

    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: ref.id,
      format: 'full'
    });

    const summary = transformMessage(messageResponse.data);
    if (summary.attachments.length > 0) {
      results.push(summary);
    }
  }

  return results;
}

