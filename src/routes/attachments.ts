import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';

import { createPresignedUploadUrl } from '../lib/s3';

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

export const attachmentsRoute = new Hono();

attachmentsRoute.post(
  '/presign',
  zValidator('json', presignSchema),
  async (c) => {
    const { filename, contentType, size } = c.req.valid('json');

    if (size && size > MAX_UPLOAD_SIZE_BYTES) {
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

    const { uploadUrl, expiresIn } = await createPresignedUploadUrl({
      key: objectKey,
      contentType
    });

    return c.json({
      key: objectKey,
      uploadUrl,
      expiresIn,
      maxSize: MAX_UPLOAD_SIZE_BYTES
    });
  }
);

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-200);
}

