import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';

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

export async function extractInvoiceData({
  emailContent,
  attachments = []
}: ExtractInvoiceParams): Promise<InvoiceExtraction> {
  try {
    const messages = buildMessages(emailContent, attachments);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages
    });

    const rawContent = extractResponseText(response);

    const parsed = JSON.parse(rawContent);

    const extraction = InvoiceExtractionSchema.parse({
      ...parsed,
      aiEnhancements: {
        ...(parsed.aiEnhancements ?? {}),
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

function buildMessages(
  emailContent?: string,
  attachments: AttachmentInput[] = []
) {
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
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Invoice attachment (${attachment.contentType})`
        },
        {
          type: 'image_url',
          image_url: {
            url: attachment.url
          }
        }
      ]
    });
  }

  return messages;
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

  if (Array.isArray(content)) {
    const textPart = content.find(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part?.type === 'text'
    );

    if (textPart) {
      return textPart.text;
    }
  }

  throw new InvoiceExtractionError(
    'OpenAI response did not include textual content'
  );
}

