import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { logger } from './logger';

export const InvoiceLineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nonnegative().default(1),
  unitPrice: z.number().nonnegative(),
  amount: z.number().nonnegative(),
  category: z.string().optional()
});

export const InvoiceExtractionSchema = z.object({
  vendor: z.object({
    name: z.string(),
    taxId: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional()
  }),
  invoice: z.object({
    number: z.string(),
    date: z.string(),
    dueDate: z.string().optional(),
    currency: z.string().default('USD'),
    subtotal: z.number().nonnegative().optional(),
    taxAmount: z.number().nonnegative().optional(),
    totalAmount: z.number().nonnegative()
  }),
  assignment: z.object({
    department: z.string().optional(),
    employee: z.string().optional(),
    costCenter: z.string().optional()
  }),
  lineItems: z.array(InvoiceLineItemSchema).min(1),
  aiEnhancements: z
    .object({
      confidence: z.number().min(0).max(1).optional(),
      suggestedCategories: z.array(z.string()).optional(),
      processingTimestamp: z.string().optional()
    })
    .optional()
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

export type AttachmentInput = {
  url: string;
  contentType: string;
  filename?: string;
  size?: number;
};

export type ExtractInvoiceParams = {
  emailContent?: string;
  attachments?: AttachmentInput[];
};

declare global {
  // eslint-disable-next-line no-var
  var __openaiClient__: OpenAI | undefined;
}

function createClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  return new OpenAI({
    apiKey
  });
}

export const openai = globalThis.__openaiClient__ ?? createClient();

if (!globalThis.__openaiClient__) {
  globalThis.__openaiClient__ = openai;
}

export class InvoiceExtractionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'InvoiceExtractionError';
  }
}

const SYSTEM_PROMPT = `
You are an expert invoice extraction system.

Return ONLY valid JSON that matches the provided schema. Do not include code blocks.

Guidelines:
- Extract vendor details from the invoice
- Return accurate monetary values as numbers
- Provide ISO 8601 dates (YYYY-MM-DD) when possible
- Include every line item with description, quantity, unit price, and total amount
- Suggest the most likely department or employee when available
- If information is missing, omit the field rather than guessing
`.trim();

const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp'
]);

const PDF_CONTENT_TYPES = new Set(['application/pdf']);

const PDF_TEXT_CHUNK_SIZE = 4000;
const PDF_TEXT_MAX_CHUNKS = 5;

type PdfParseFn = (data: Uint8Array) => Promise<{ text: string }>;

let pdfParseLoader: Promise<PdfParseFn> | null = null;

export async function extractInvoiceData({
  emailContent,
  attachments = []
}: ExtractInvoiceParams): Promise<InvoiceExtraction> {
  try {
    const messages = await buildMessages(emailContent, attachments);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages
    });

    const rawContent = extractResponseText(response);
    logger.info({ rawContent }, 'OpenAI response');

    const parsed = JSON.parse(rawContent);
    logger.info({ parsed }, 'Parsed response');

    const normalized = normalizeExtractionPayload(parsed);
    const normalizedRecord = isRecord(normalized) ? normalized : {};

    const extraction = InvoiceExtractionSchema.parse({
      ...normalizedRecord,
      aiEnhancements: {
        ...(isRecord(normalizedRecord.aiEnhancements)
          ? normalizedRecord.aiEnhancements
          : undefined),
        processingTimestamp: new Date().toISOString()
      }
    });

    return extraction;
  } catch (error) {
    if (error instanceof InvoiceExtractionError) {
      throw error;
    }
    throw new InvoiceExtractionError('Failed to extract invoice data', error);
  }
}

async function buildMessages(
  emailContent?: string,
  attachments: AttachmentInput[] = []
): Promise<ChatCompletionMessageParam[]> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    }
  ];

  if (emailContent) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Email content:\n${emailContent}`
        }
      ]
    });
  }

  for (const attachment of attachments) {
    const contentType = normalizeContentType(attachment.contentType);
    const displayName = getAttachmentDisplayName(attachment);

    if (SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Invoice attachment "${displayName}" (${contentType})`
          },
          {
            type: 'image_url',
            image_url: {
              url: attachment.url
            }
          }
        ]
      });
      continue;
    }

    if (PDF_CONTENT_TYPES.has(contentType)) {
      const pdfText = await extractTextFromPdf(attachment);
      const { chunks, truncated, usedLength, totalLength } =
        chunkPdfText(pdfText);

      if (chunks.length === 0) {
        throw new InvoiceExtractionError(
          `No extractable text found in PDF attachment "${displayName}".`
        );
      }

      const totalChunks = chunks.length;
      chunks.forEach((chunk, index) => {
        const truncationNote =
          truncated && index === totalChunks - 1
            ? `\n\n[Note: truncated to the first ${usedLength} of ${totalLength} characters.]`
            : '';

        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extracted text from PDF attachment "${displayName}" (part ${
                index + 1
              } of ${totalChunks})${truncationNote}\n\n${chunk}`
            }
          ]
        });
      });
      continue;
    }

    throw new InvoiceExtractionError(
      `Unsupported attachment content type "${attachment.contentType}". ` +
        'Supported types: PDF, PNG, JPEG, GIF, WEBP.'
    );
  }

  return messages;
}

function normalizeContentType(contentType: string) {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function getAttachmentDisplayName(attachment: AttachmentInput) {
  const candidate = attachment.filename?.trim();
  return candidate && candidate.length > 0 ? candidate : 'attachment';
}

async function extractTextFromPdf(attachment: AttachmentInput): Promise<string> {
  const displayName = getAttachmentDisplayName(attachment);
  let response: Response;

  try {
    response = await fetch(attachment.url);
  } catch (error) {
    throw new InvoiceExtractionError(
      `Failed to download PDF attachment "${displayName}".`,
      error
    );
  }

  if (!response.ok) {
    throw new InvoiceExtractionError(
      `Failed to download PDF attachment "${displayName}": ${response.status} ${response.statusText}`
    );
  }

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await response.arrayBuffer();
  } catch (error) {
    throw new InvoiceExtractionError(
      `Failed to read PDF attachment "${displayName}".`,
      error
    );
  }

  let pdfParse: PdfParseFn;
  try {
    pdfParse = await loadPdfParse();
  } catch (error) {
    throw new InvoiceExtractionError(
      'PDF parsing module is not available.',
      error
    );
  }

  const data = new Uint8Array(arrayBuffer);

  try {
    const result = await pdfParse(data);
    return result?.text ?? '';
  } catch (error) {
    throw new InvoiceExtractionError(
      `Failed to extract text from PDF attachment "${displayName}".`,
      error
    );
  }
}

function chunkPdfText(text: string) {
  const normalized = normalizePdfText(text);
  const totalLength = normalized.length;
  if (totalLength === 0) {
    return {
      chunks: [] as string[],
      truncated: false,
      usedLength: 0,
      totalLength: 0
    };
  }

  const maxLength = PDF_TEXT_CHUNK_SIZE * PDF_TEXT_MAX_CHUNKS;
  const truncatedText =
    totalLength > maxLength ? normalized.slice(0, maxLength) : normalized;
  const truncated = truncatedText.length < totalLength;

  const chunks: string[] = [];
  for (let index = 0; index < truncatedText.length; index += PDF_TEXT_CHUNK_SIZE) {
    const chunk = truncatedText.slice(index, index + PDF_TEXT_CHUNK_SIZE).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return {
    chunks,
    truncated,
    usedLength: truncatedText.length,
    totalLength
  };
}

function normalizePdfText(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function loadPdfParse(): Promise<PdfParseFn> {
  if (!pdfParseLoader) {
    pdfParseLoader = import('pdf-parse').then((mod: unknown) => {
      const candidate = mod as { default?: PdfParseFn };
      const fn =
        typeof candidate === 'function'
          ? (candidate as PdfParseFn)
          : typeof candidate?.default === 'function'
            ? candidate.default
            : null;

      if (!fn) {
        throw new Error('Failed to load pdf-parse module');
      }

      return fn;
    });
  }

  return pdfParseLoader;
}

function extractResponseText(
  response: OpenAI.Chat.Completions.ChatCompletion
) {
  const choice = response.choices[0];
  const { message } = choice;
  if (!message?.content) {
    throw new InvoiceExtractionError('OpenAI returned an empty response');
  }

  const { content } = message;

  if (typeof content === 'string') {
    return content;
  }

  throw new InvoiceExtractionError(
    'OpenAI response did not include textual content'
  );
}

function normalizeExtractionPayload(input: unknown): unknown {
  if (!isRecord(input)) {
    return {};
  }

  const vendorSource = isRecord(input.vendor) ? input.vendor : {};
  const invoiceSource = resolveInvoiceSource(input);
  const assignmentSource = resolveAssignmentSource(input);
  const lineItemsSource = resolveLineItems(invoiceSource, input);

  const vendorName =
    getString(vendorSource, ['name', 'vendor_name', 'company']) ??
    'Unknown Vendor';

  const vendorTaxId =
    getString(vendorSource, [
      'taxId',
      'tax_id',
      'tax_id_number',
      'vat_number',
      'vatNumber'
    ]) ?? undefined;

  const invoiceNumber =
    getString(invoiceSource, ['number', 'invoice_number', 'id']) ??
    getString(input, ['invoice_number']) ??
    'UNKNOWN';

  const invoiceDate =
    getString(invoiceSource, [
      'date',
      'issue_date',
      'invoice_date',
      'created_at'
    ]) ?? getString(input, ['issue_date']) ??
    new Date().toISOString().slice(0, 10);

  const invoiceDueDate =
    getString(invoiceSource, ['dueDate', 'due_date', 'payment_due']) ??
    getString(input, ['due_date']);

  const invoiceCurrency =
    getString(invoiceSource, ['currency']) ??
    getString(input, ['currency']) ??
    'USD';

  const subtotal = getNumber(
    invoiceSource,
    ['subtotal', 'sub_total', 'amount_subtotal']
  );
  const taxAmount = getNumber(invoiceSource, ['taxAmount', 'tax', 'vat']);
  const totalAmount =
    getNumber(invoiceSource, [
      'totalAmount',
      'total',
      'total_due',
      'amount_due',
      'balance_due'
    ]) ?? getNumber(input, ['total_due', 'amount_due']);

  const normalizedLineItems = lineItemsSource
    .map((item) => normalizeLineItem(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const assignment = {
    department: getString(assignmentSource, [
      'department',
      'department_name'
    ]),
    employee:
      getString(assignmentSource, ['employee', 'employee_name', 'name']) ??
      getString(input.bill_to, ['name']) ??
      undefined,
    costCenter: getString(assignmentSource, ['costCenter', 'cost_center'])
  };

  return {
    vendor: {
      name: vendorName,
      taxId: vendorTaxId,
      address: getString(vendorSource, ['address', 'street']),
      email: getString(vendorSource, ['email', 'contact_email']),
      phone: getString(vendorSource, ['phone', 'phone_number'])
    },
    invoice: {
      number: invoiceNumber,
      date: invoiceDate,
      dueDate: invoiceDueDate ?? undefined,
      currency: invoiceCurrency,
      subtotal: subtotal ?? undefined,
      taxAmount: taxAmount ?? undefined,
      totalAmount: totalAmount ?? undefined
    },
    assignment,
    lineItems: normalizedLineItems,
    aiEnhancements: isRecord(input.aiEnhancements)
      ? input.aiEnhancements
      : undefined
  };
}

function normalizeLineItem(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const description =
    getString(value, [
      'description',
      'name',
      'item',
      'line_description',
      'product'
    ]) ?? '';

  const quantity =
    getNumber(value, ['quantity', 'qty']) ??
    getNumber(value, ['hours']) ??
    1;

  const unitPrice = getNumber(value, ['unit_price', 'unitPrice', 'price']);

  const amount =
    getNumber(value, ['amount', 'total', 'line_total']) ??
    (unitPrice !== undefined && quantity !== undefined
      ? unitPrice * quantity
      : undefined);

  if (!description || amount === undefined) {
    return null;
  }

  return {
    description,
    quantity: quantity ?? 1,
    unitPrice: unitPrice ?? amount,
    amount,
    category: getString(value, ['category', 'gl_code'])
  };
}

function resolveInvoiceSource(input: Record<string, any>) {
  if (isRecord(input.invoice)) {
    return input.invoice;
  }
  if (isRecord(input.billing)) {
    return input.billing;
  }
  return {};
}

function resolveAssignmentSource(input: Record<string, any>) {
  if (isRecord(input.assignment)) {
    return input.assignment;
  }
  if (isRecord(input.bill_to)) {
    return input.bill_to;
  }
  return {};
}

function resolveLineItems(
  invoiceSource: Record<string, any>,
  root: Record<string, any>
) {
  if (Array.isArray(invoiceSource.lineItems)) {
    return invoiceSource.lineItems;
  }
  if (Array.isArray(invoiceSource.line_items)) {
    return invoiceSource.line_items;
  }
  if (Array.isArray(root.lineItems)) {
    return root.lineItems;
  }
  if (Array.isArray(root.line_items)) {
    return root.line_items;
  }
  return [];
}

function getString(
  source: Record<string, any> | undefined,
  keys: string[]
): string | undefined {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return undefined;
}

function getNumber(
  source: Record<string, any> | undefined,
  keys: string[]
): number | undefined {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    const coerced = coerceNumber(value);
    if (coerced !== undefined) {
      return coerced;
    }
  }

  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.,-]/g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

