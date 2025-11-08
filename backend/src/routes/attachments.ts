import { Hono } from 'hono';
import { ulid } from 'ulid';

import { uploadToBlob } from '../lib/blob';
import { logger, type AppEnv } from '../lib/logger';

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif'
]);

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export const attachmentsRoute = new Hono<AppEnv>();

attachmentsRoute.post(
  '/upload',
  async (c) => {
    const log = c.get('logger') ?? logger;

    const contentTypeHeader = c.req.header('content-type') ?? '';
    if (!contentTypeHeader.toLowerCase().includes('multipart/form-data')) {
      log.warn(
        { contentTypeHeader },
        'Attachment upload received non-multipart request'
      );
      return c.json(
        { error: 'Expected multipart/form-data request with attachment' },
        400
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch (err) {
      log.warn({ err }, 'Failed to parse multipart form data');
      return c.json({ error: 'Invalid multipart form data' }, 400);
    }

    const fileField = formData.get('file');

    if (!isMultipartFile(fileField)) {
      log.warn(
        { providedFields: [...formData.keys()] },
        'Attachment upload missing file field'
      );
      return c.json({ error: 'Attachment file is required' }, 400);
    }

    const overrideFilename = getOptionalString(formData.get('filename'));
    const contentTypeOverride = getOptionalString(formData.get('contentType'));

    const originalFilename =
      overrideFilename ?? fileField.name ?? 'attachment';
    const sanitizedFilename = sanitizeFilename(originalFilename);

    const contentType = contentTypeOverride ?? fileField.type;

    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      log.warn(
        { contentType, originalFilename },
        'Attachment upload has unsupported content type'
      );
      return c.json({ error: 'Unsupported content type' }, 400);
    }

    const size = fileField.size;

    log.trace(
      { filename: sanitizedFilename, contentType, size },
      'Received attachment upload request'
    );

    if (size > MAX_UPLOAD_SIZE_BYTES) {
      log.warn(
        {
          filename: sanitizedFilename,
          contentType,
          size,
          maxAllowed: MAX_UPLOAD_SIZE_BYTES
        },
        'Attachment exceeds maximum upload size'
      );
      return c.json(
        {
          error: 'Attachment too large',
          maxSize: MAX_UPLOAD_SIZE_BYTES
        },
        400
      );
    }

    const objectKey = `attachments/${ulid()}-${sanitizedFilename}`;

    log.trace({ objectKey }, 'Generated object key for attachment');

    try {
      const uploadResult = await uploadToBlob({
        key: objectKey,
        data: fileField,
        contentType
      });

      log.trace({ objectKey, url: uploadResult.url }, 'Uploaded attachment');

      return c.json({
        key: uploadResult.key,
        url: uploadResult.url,
        publicUrl: uploadResult.publicUrl,
        contentType: uploadResult.contentType,
        filename: sanitizedFilename,
        maxSize: MAX_UPLOAD_SIZE_BYTES
      });
    } catch (err) {
      log.error({ err, objectKey }, 'Failed to upload attachment to blob');
      return c.json(
        {
          error: 'Failed to upload attachment'
        },
        500
      );
    }
  }
);

function sanitizeFilename(filename: string) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const trimmed = sanitized.replace(/^_+|_+$/g, '');
  const safeName = trimmed.length > 0 ? trimmed : 'attachment';
  return safeName.slice(-200);
}

function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type MultipartFile = {
  name?: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isMultipartFile(value: unknown): value is MultipartFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<MultipartFile>;
  return (
    typeof candidate.size === 'number' &&
    typeof candidate.type === 'string' &&
    typeof candidate.arrayBuffer === 'function'
  );
}

