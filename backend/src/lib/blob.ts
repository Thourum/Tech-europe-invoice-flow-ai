import { getDownloadUrl, head } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

const DEFAULT_PRESIGN_TTL_SECONDS = 900;
const DEFAULT_BLOB_API_URL = 'https://vercel.com/api/blob';

type PresignOptions = {
  key: string;
  contentType?: string;
  expiresIn?: number;
  maxSizeBytes?: number;
};

type UploadPresignResult = {
  uploadUrl: string;
  uploadToken: string;
  authorizationHeader: string;
  expiresIn: number;
  expiresAt: string;
  publicUrl: string;
};

type DownloadPresignResult = {
  downloadUrl: string;
  publicUrl: string;
  expiresIn: number;
};

export async function createPresignedUploadUrl({
  key,
  contentType,
  expiresIn = DEFAULT_PRESIGN_TTL_SECONDS,
  maxSizeBytes
}: PresignOptions): Promise<UploadPresignResult> {
  const sanitizedKey = normalizeKey(key);
  const ttlMs = Math.max(expiresIn, 1) * 1000;
  const validUntil = Date.now() + ttlMs;

  const uploadToken = await generateClientTokenFromReadWriteToken({
    token: getReadWriteToken(),
    pathname: sanitizedKey,
    allowedContentTypes: contentType ? [contentType] : undefined,
    maximumSizeInBytes: maxSizeBytes,
    validUntil
  });

  const uploadUrl = buildUploadUrl(sanitizedKey);
  const publicUrl = resolveBlobUrl(sanitizedKey);

  return {
    uploadUrl,
    uploadToken,
    authorizationHeader: `Bearer ${uploadToken}`,
    expiresIn,
    expiresAt: new Date(validUntil).toISOString(),
    publicUrl
  };
}

export async function createPresignedDownloadUrl({
  key,
  expiresIn = DEFAULT_PRESIGN_TTL_SECONDS
}: Omit<PresignOptions, 'contentType' | 'maxSizeBytes'>): Promise<DownloadPresignResult> {
  const sanitizedKey = normalizeKey(key);
  const publicUrl = resolveBlobUrl(sanitizedKey);
  const metadata = await head(publicUrl);

  return {
    downloadUrl: metadata.downloadUrl ?? getDownloadUrl(publicUrl),
    publicUrl,
    expiresIn
  };
}

export function resolveBlobUrl(key: string): string {
  const baseUrl = getPublicBaseUrl();
  const trimmedBase = baseUrl.endsWith('/')
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const encodedKey = sanitizeForUrlPath(normalizeKey(key));
  return `${trimmedBase}/${encodedKey}`;
}

function normalizeKey(key: string) {
  if (!key) {
    throw new Error('Blob key must be provided');
  }
  return key.replace(/^\/+/, '');
}

function sanitizeForUrlPath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildUploadUrl(key: string) {
  const params = new URLSearchParams({ pathname: key });
  const baseUrl =
    process.env.VERCEL_BLOB_API_URL ??
    process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ??
    DEFAULT_BLOB_API_URL;
  const trimmedBase = baseUrl.endsWith('/')
    ? baseUrl.slice(0, -1)
    : baseUrl;
  return `${trimmedBase}/?${params.toString()}`;
}

function getPublicBaseUrl() {
  const override = process.env.BLOB_PUBLIC_BASE_URL;
  if (override && override.trim().length > 0) {
    return override.trim();
  }

  const storeId = getStoreIdFromToken(getReadWriteToken());
  return `https://${storeId}.public.blob.vercel-storage.com`;
}

function getReadWriteToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }
  return token;
}

function getStoreIdFromToken(token: string) {
  const parts = token.split('_');
  if (parts.length < 5) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is invalid or missing the store identifier'
    );
  }
  const storeId = parts[3];
  if (!storeId) {
    throw new Error(
      'Unable to derive store identifier from BLOB_READ_WRITE_TOKEN'
    );
  }
  return storeId;
}
