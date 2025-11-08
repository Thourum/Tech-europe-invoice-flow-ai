import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_PRESIGN_TTL_SECONDS = 900;

type PresignOptions = {
  key: string;
  contentType?: string;
  expiresIn?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __s3Client__: S3Client | undefined;
}

function createS3Client(): S3Client {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('AWS_REGION is not set');
  }

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error(
      'Both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set when using static credentials'
    );
  }

  return new S3Client({
    region,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey
          }
        : undefined
  });
}

export const s3Client: S3Client =
  globalThis.__s3Client__ ?? createS3Client();

if (!globalThis.__s3Client__) {
  globalThis.__s3Client__ = s3Client;
}

export async function createPresignedUploadUrl({
  key,
  contentType,
  expiresIn = DEFAULT_PRESIGN_TTL_SECONDS
}: PresignOptions) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not set');
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

  return {
    uploadUrl,
    expiresIn
  };
}

export async function createPresignedDownloadUrl({
  key,
  expiresIn = DEFAULT_PRESIGN_TTL_SECONDS
}: Omit<PresignOptions, 'contentType'>) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not set');
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });

  return {
    downloadUrl,
    expiresIn
  };
}

export function getS3Bucket() {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not set');
  }
  return bucket;
}

