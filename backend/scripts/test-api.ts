/**
 * Standalone TypeScript script that exercises the InvoiceFlow backend API.
 *
 * It follows the flow described in `backend/docs/api.md` and mirrors the manual
 * curl snippet from `@Untitled-1`: health check → attachment upload →
 * invoice processing → optional invoice listing.
 *
 * Run with:
 *   npx tsx backend/scripts/test-api.ts --file backend/INV-9034295.pdf
 *
 * Options:
 *   --file / -f       Path to the invoice file to upload (required)
 *   --base-url        API base URL (default: http://localhost:3000 or $API_BASE_URL)
 *   --email-id        Optional email id to associate with the invoice
 *   --content         Optional inline email content instead of attachments
 *   --list            Fetches the latest invoices after processing
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

type ScriptOptions = {
  filePath: string | null;
  baseUrl: string;
  emailId?: string;
  content?: string;
  listAfterProcess: boolean;
};

type AttachmentUploadResponse = {
  key: string;
  publicUrl: string;
  url?: string;
  maxSize: number;
};

type InvoiceProcessResponse = {
  invoice: unknown;
  extraction: unknown;
};

type InvoiceListResponse = {
  invoices: unknown[];
  nextCursor?: string | null;
};

const ALLOWED_EXTENSIONS = new Map<string, string>([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif']
]);

async function main() {
  const options = parseArgs();

  if (!options.filePath && !options.content) {
    fail('Either --file or --content must be provided.');
  }

  console.log(`Using API base URL: ${options.baseUrl}`);

  await checkHealth(options.baseUrl);

  let attachmentPayload: {
    key: string;
    filename: string;
    contentType: string;
    size?: number;
  }[] = [];

  if (options.filePath) {
    const {
      key,
      filename,
      contentType,
      size,
      publicUrl
    } = await uploadAttachment(options.baseUrl, options.filePath);

    attachmentPayload = [
      {
        key,
        filename,
        contentType,
        size
      }
    ];

    console.log(`Attachment uploaded. Public URL (once processed): ${publicUrl}`);
  }

  if (!options.content && attachmentPayload.length === 0) {
    fail('No content provided for invoice processing.');
  }

  const processResponse = await processInvoice(options.baseUrl, {
    emailId: options.emailId,
    content: options.content,
    attachments: attachmentPayload.length > 0 ? attachmentPayload : undefined
  });

  console.log('Invoice processing response:');
  console.log(JSON.stringify(processResponse, null, 2));

  if (options.listAfterProcess) {
    await listInvoices(options.baseUrl);
  }

  console.log('Done ✅');
}

async function checkHealth(baseUrl: string) {
  const url = joinUrl(baseUrl, '/health');
  process.stdout.write('Checking API health... ');
  const response = await requestJson<{ ok: boolean }>(url);
  if (!response.ok) {
    fail('Health check failed');
  }
  console.log('OK');
}

async function uploadAttachment(baseUrl: string, filePath: string) {
  const resolvedPath = path.resolve(filePath);
  const stats = await fs.stat(resolvedPath);
  if (!stats.isFile()) {
    fail(`Path is not a file: ${resolvedPath}`);
  }

  const size = stats.size;
  const filename = path.basename(resolvedPath);
  const contentType = detectContentType(filename);
  const uploadUrl = joinUrl(baseUrl, '/attachments/upload');

  console.log(
    `Uploading ${filename} (${contentType}, ${size} bytes) via API...`
  );

  const fileBuffer = await fs.readFile(resolvedPath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: contentType });
  formData.append('file', blob, filename);
  formData.append('filename', filename);
  formData.append('contentType', contentType);

  const uploadResponse = await requestJson<AttachmentUploadResponse>(uploadUrl, {
    method: 'POST',
    body: formData
  });

  console.log('Attachment uploaded.');

  return {
    key: uploadResponse.key,
    filename,
    contentType,
    size,
    publicUrl: uploadResponse.publicUrl
  };
}

async function processInvoice(
  baseUrl: string,
  payload: {
    emailId?: string;
    content?: string;
    attachments?: {
      key: string;
      filename: string;
      contentType: string;
      size?: number;
    }[];
  }
) {
  const url = joinUrl(baseUrl, '/invoices/process');
  console.log('Triggering invoice processing...');
  return requestJson<InvoiceProcessResponse>(url, {
    method: 'POST',
    body: payload
  });
}

async function listInvoices(baseUrl: string) {
  const url = joinUrl(baseUrl, '/invoices?limit=5');
  console.log('Fetching recent invoices...');
  const response = await requestJson<InvoiceListResponse>(url);
  console.log(JSON.stringify(response, null, 2));
}

async function requestJson<T>(
  url: string,
  init: RequestJsonInit = {}
): Promise<T> {
  const { body: rawBody, headers: rawHeaders, ...rest } = init;

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  let body: BodyInit | undefined;

  if (rawHeaders) {
    if (rawHeaders instanceof Headers) {
      for (const [key, value] of rawHeaders.entries()) {
        headers[key] = value;
      }
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, rawHeaders as Record<string, string>);
    }
  }

  if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
    body = rawBody;
  } else if (rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(rawBody);
  }

  const response = await fetch(url, {
    ...(rest as RequestInit),
    headers,
    body
  });

  const parsed = await safeReadBody(response);

  if (!response.ok) {
    const description =
      typeof parsed === 'string'
        ? parsed
        : JSON.stringify(parsed, null, 2);
    fail(`Request to ${url} failed with ${response.status} ${response.statusText}: ${description}`);
  }

  return parsed as T;
}

type RequestJsonInit = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: HeadersInit;
};

async function safeReadBody(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function detectContentType(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  const contentType = ALLOWED_EXTENSIONS.get(ext);
  if (!contentType) {
    fail(
      `Unable to determine content type for ${filename}. Supported extensions: ${[
        ...ALLOWED_EXTENSIONS.keys()
      ].join(', ')}`
    );
  }
  return contentType;
}

function joinUrl(base: string, pathSuffix: string) {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedSuffix = pathSuffix.startsWith('/')
    ? pathSuffix
    : `/${pathSuffix}`;
  return `${normalizedBase}${normalizedSuffix}`;
}

function parseArgs(): ScriptOptions {
  const defaults = {
    baseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000'
  };

  const args = process.argv.slice(2);
  let filePath: string | null = null;
  let baseUrl = defaults.baseUrl;
  let emailId: string | undefined;
  let content: string | undefined;
  let listAfterProcess = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--file':
      case '-f':
        filePath = args[++i] ?? null;
        break;
      case '--base-url':
        baseUrl = args[++i] ?? baseUrl;
        break;
      case '--email-id':
        emailId = args[++i] ?? emailId;
        break;
      case '--content':
        content = args[++i] ?? content;
        break;
      case '--list':
        listAfterProcess = true;
        break;
      case '--help':
      case '-h':
        showUsage();
        process.exit(0);
      default:
        if (arg.startsWith('--file=')) {
          filePath = arg.slice('--file='.length);
        } else if (arg.startsWith('--base-url=')) {
          baseUrl = arg.slice('--base-url='.length);
        } else if (arg.startsWith('--email-id=')) {
          emailId = arg.slice('--email-id='.length);
        } else if (arg.startsWith('--content=')) {
          content = arg.slice('--content='.length);
        } else if (arg === '--no-list') {
          listAfterProcess = false;
        } else {
          fail(`Unknown argument: ${arg}`);
        }
    }
  }

  return {
    filePath,
    baseUrl,
    emailId,
    content,
    listAfterProcess
  };
}

function showUsage() {
  console.log(`Usage: tsx backend/scripts/test-api.ts --file path/to/invoice.pdf [options]

Options:
  --file, -f        Path to invoice file to upload (required unless --content supplied)
  --base-url        API base URL (default: http://localhost:3000)
  --email-id        Optional email identifier for the payload
  --content         Inline email body to process without attachments
  --list            Fetch the latest invoices after processing
  --help, -h        Show this help message`);
}

function fail(message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

await main();

