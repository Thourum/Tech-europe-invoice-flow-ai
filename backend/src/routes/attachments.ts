import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';

import { createPresignedUploadUrl } from '../lib/blob';
import { logger, type AppEnv } from '../lib/logger';

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif'
]);

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

const presignSchema = z
  .object({
    filename: z.string().min(1).max(256),
    contentType: z.string().min(1).max(128),
    size: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES).optional()
  })
  .superRefine((data, ctx) => {
    if (!ALLOWED_CONTENT_TYPES.has(data.contentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unsupported content type',
        path: ['contentType']
      });
    }
  });

export const attachmentsRoute = new Hono<AppEnv>();

attachmentsRoute.post(
  '/presign',
  zValidator('json', presignSchema),
  async (c) => {
    const { filename, contentType, size } = c.req.valid('json');
    const log = c.get('logger') ?? logger;

    log.trace(
      { filename, contentType, size },
      'Received attachment presign request'
    );

    if (size && size > MAX_UPLOAD_SIZE_BYTES) {
      log.warn(
        { filename, contentType, size, maxAllowed: MAX_UPLOAD_SIZE_BYTES },
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

    const sanitizedFilename = sanitizeFilename(filename);
    const objectKey = `attachments/${ulid()}-${sanitizedFilename}`;

    log.trace({ objectKey }, 'Generated object key for attachment');

    const presign = await createPresignedUploadUrl({
      key: objectKey,
      contentType,
      maxSizeBytes: size
    });

    log.trace({ objectKey }, 'Created presigned upload URL');

    return c.json({
      key: objectKey,
      ...presign,
      maxSize: MAX_UPLOAD_SIZE_BYTES
    });
  }
);

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-200);
}

