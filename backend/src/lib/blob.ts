import { getDownloadUrl, head, put } from '@vercel/blob';

const DEFAULT_PRESIGN_TTL_SECONDS = 900;

type UploadOptions = {
  key: string;
  data: Blob | File | ArrayBuffer | Buffer | Uint8Array | ReadableStream | string;
  contentType?: string;
};

type UploadResult = {
  key: string;
  url: string;
  publicUrl: string;
  contentType: string;
};

type DownloadOptions = {
  key: string;
  expiresIn?: number;
};

type DownloadPresignResult = {
  downloadUrl: string;
  publicUrl: string;
  expiresIn: number;
};

export async function uploadToBlob({
  key,
  data,
  contentType
}: UploadOptions): Promise<UploadResult> {
  const sanitizedKey = normalizeKey(key);
  const blob = await put(sanitizedKey, data as any, {
    contentType,
    addRandomSuffix: false,
    access: 'public',
    token: getReadWriteToken()
  });

  return {
    key: sanitizedKey,
    url: blob.url,
    publicUrl: resolveBlobUrl(sanitizedKey),
    contentType: blob.contentType ?? contentType ?? 'application/octet-stream'
  };
}

export async function createPresignedDownloadUrl({
  key,
  expiresIn = DEFAULT_PRESIGN_TTL_SECONDS
}: DownloadOptions): Promise<DownloadPresignResult> {
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
