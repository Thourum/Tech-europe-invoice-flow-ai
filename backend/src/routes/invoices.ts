import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { and, eq, like, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { ulid } from 'ulid';

import { db } from '../db/client';
import {
  attachments as attachmentsTable,
  invoiceLineItems,
  invoiceStatusOptions,
  invoices,
  type InvoiceStatus,
  type InvoiceLineItem,
  type Attachment as AttachmentRow
} from '../db/schema';
import { createPresignedDownloadUrl } from '../lib/blob';
import {
  extractInvoiceData,
  type AttachmentInput
} from '../lib/openai';
import { logger, type AppEnv } from '../lib/logger';

const attachmentsInputSchema = z.object({
  key: z
    .string()
    .min(3)
    .max(512)
    .regex(/^[a-zA-Z0-9/_\\.\-]+$/),
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128),
  size: z.number().int().nonnegative().optional()
});

const processInvoiceSchema = z
  .object({
    emailId: z.string().optional(),
    content: z.string().optional(),
    attachments: z.array(attachmentsInputSchema).default([])
  })
  .superRefine((data, ctx) => {
    if (!data.content && data.attachments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either content or attachments must be provided'
      });
    }
  });

const listInvoicesSchema = z.object({
  status: z.enum(invoiceStatusOptions).optional(),
  vendor: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

const updateInvoiceSchema = z
  .object({
    status: z.enum(invoiceStatusOptions).optional(),
    approverNotes: z.string().max(2000).nullish()
  })
  .refine(
    (data) => data.status !== undefined || data.approverNotes !== undefined,
    'At least one field must be provided'
  );

export const invoicesRoute = new Hono<AppEnv>();

invoicesRoute.post(
  '/process',
  zValidator('json', processInvoiceSchema),
  async (c) => {
    const { emailId, content, attachments } = c.req.valid('json');
    const log = c.get('logger') ?? logger;

    log.trace(
      {
        emailId,
        hasContent: Boolean(content),
        attachmentCount: attachments.length
      },
      'Processing invoice request'
    );

    const attachmentInputs: AttachmentInput[] = await Promise.all(
      attachments.map(async (attachment) => {
        const { downloadUrl } = await createPresignedDownloadUrl({
          key: attachment.key,
          expiresIn: 600
        });

        return {
          url: downloadUrl,
          contentType: attachment.contentType
        };
      })
    );

    const extraction = await extractInvoiceData({
      emailContent: content,
      attachments: attachmentInputs
    });

    log.trace(
      {
        vendorName: extraction.vendor.name,
        invoiceNumber: extraction.invoice.number
      },
      'Completed invoice data extraction'
    );

    const invoiceId = ulid();
    const now = Date.now();

    const result = await db.transaction(async (tx) => {
      await tx.insert(invoices).values({
        id: invoiceId,
        emailId,
        status: 'pending',
        vendorName: extraction.vendor.name,
        vendorTaxId: extraction.vendor.taxId ?? null,
        invoiceNumber: extraction.invoice.number,
        invoiceDate: extraction.invoice.date,
        dueDate: extraction.invoice.dueDate ?? null,
        currency: extraction.invoice.currency,
        subtotal: extraction.invoice.subtotal ?? null,
        taxAmount: extraction.invoice.taxAmount ?? null,
        totalAmount: extraction.invoice.totalAmount,
        assignmentDepartment: extraction.assignment.department ?? null,
        assignmentEmployee: extraction.assignment.employee ?? null,
        assignmentCostCenter: extraction.assignment.costCenter ?? null,
        createdAt: now,
        updatedAt: now
      });

      if (extraction.lineItems.length > 0) {
        await tx.insert(invoiceLineItems).values(
          extraction.lineItems.map((item, index) => ({
            id: ulid(),
            invoiceId,
            description: item.description,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice,
            amount: item.amount,
            category: item.category ?? null,
            sortOrder: index,
            createdAt: now
          }))
        );
      }

      if (attachments.length > 0) {
        await tx.insert(attachmentsTable).values(
          attachments.map((attachment) => ({
            id: ulid(),
            invoiceId,
            s3Key: attachment.key,
            filename: attachment.filename,
            mimeType: attachment.contentType,
            size: attachment.size ?? null,
            createdAt: now
          }))
        );
      }

      return tx.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
        with: {
          lineItems: true,
          attachments: true
        }
      });
    });

    if (!result) {
      log.error(
        { emailId, attachmentCount: attachments.length },
        'Invoice transaction returned no result'
      );
      return c.json({ error: 'Failed to create invoice' }, 500);
    }

    log.trace(
      { invoiceId: result.id, vendorName: result.vendorName },
      'Created invoice record'
    );

    return c.json({
      invoice: serializeInvoice(result),
      extraction
    });
  }
);

invoicesRoute.get('/', zValidator('query', listInvoicesSchema), async (c) => {
  const log = c.get('logger') ?? logger;
  const { status, vendor, q, cursor, limit } = c.req.valid('query');

  log.trace(
    { status, vendor, q, cursor, limit },
    'Listing invoices'
  );
  const conditions = [];

  if (status) {
    conditions.push(eq(invoices.status, status));
  }

  if (vendor) {
    const vendorLike = `%${vendor}%`;
    conditions.push(
      like(invoices.vendorName, vendorLike)
    );
  }

  if (q) {
    const lookup = `%${q}%`;
    conditions.push(
      or(
        like(invoices.vendorName, lookup),
        like(invoices.invoiceNumber, lookup)
      )
    );
  }

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const { createdAt, id } = decoded;
      conditions.push(
        or(
          lt(invoices.createdAt, createdAt),
          and(
            eq(invoices.createdAt, createdAt),
            lt(invoices.id, id)
          )
        )
      );
    }
  }

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.query.invoices.findMany({
    where: whereClause,
    with: {
      lineItems: true,
      attachments: true
    },
    orderBy: (fields, { desc: orderDesc }) => [
      orderDesc(fields.createdAt),
      orderDesc(fields.id)
    ],
    limit: limit + 1
  });

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = rows.pop();
    if (last) {
      nextCursor = encodeCursor({
        id: last.id,
        createdAt: last.createdAt ?? 0
      });
    }
  }

  log.trace(
    { resultCount: rows.length, hasNextCursor: Boolean(nextCursor) },
    'Listed invoices'
  );

  return c.json({
    invoices: rows.map(serializeInvoice),
    nextCursor
  });
});

invoicesRoute.get('/:id', async (c) => {
  const log = c.get('logger') ?? logger;
  const id = c.req.param('id');

  log.trace({ id }, 'Fetching invoice by id');

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: {
      lineItems: true,
      attachments: true
    }
  });

  if (!invoice) {
    log.warn({ id }, 'Invoice not found');
    return c.json({ error: 'Invoice not found' }, 404);
  }

  log.trace({ id }, 'Fetched invoice by id');

  return c.json({
    invoice: serializeInvoice(invoice)
  });
});

invoicesRoute.patch(
  '/:id',
  zValidator('json', updateInvoiceSchema),
  async (c) => {
    const log = c.get('logger') ?? logger;
    const id = c.req.param('id');
    const body = c.req.valid('json');

    log.trace(
      {
        id,
        status: body.status,
        hasApproverNotes: body.approverNotes !== undefined
      },
      'Updating invoice'
    );

    const updatePayload: Partial<{
      status: InvoiceStatus;
      approverNotes: string | null;
      updatedAt: number;
    }> = {
      updatedAt: Date.now()
    };

    if (body.status) {
      updatePayload.status = body.status;
    }

    if (body.approverNotes !== undefined) {
      updatePayload.approverNotes =
        body.approverNotes === null ? null : body.approverNotes;
    }

    const result = await db
      .update(invoices)
      .set(updatePayload)
      .where(eq(invoices.id, id))
      .returning()
      .then((rows) => rows[0]);

    if (!result) {
      log.warn({ id }, 'Invoice not found during update');
      return c.json({ error: 'Invoice not found' }, 404);
    }

    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, id),
      with: {
        lineItems: true,
        attachments: true
      }
    });

    if (!invoice) {
      log.warn({ id }, 'Invoice not found after update');
      return c.json({ error: 'Invoice not found' }, 404);
    }

    log.trace({ id }, 'Updated invoice');

    return c.json({
      invoice: serializeInvoice(invoice)
    });
  }
);

type InvoiceWithRelations = (typeof invoices.$inferSelect) & {
  lineItems: InvoiceLineItem[];
  attachments: AttachmentRow[];
};

function serializeInvoice(invoice: InvoiceWithRelations) {
  return {
    id: invoice.id,
    emailId: invoice.emailId,
    status: invoice.status,
    vendor: {
      name: invoice.vendorName,
      taxId: invoice.vendorTaxId ?? undefined
    },
    invoice: {
      number: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate ?? undefined,
      currency: invoice.currency,
      subtotal: invoice.subtotal ?? undefined,
      taxAmount: invoice.taxAmount ?? undefined,
      totalAmount: invoice.totalAmount
    },
    assignment: {
      department: invoice.assignmentDepartment ?? undefined,
      employee: invoice.assignmentEmployee ?? undefined,
      costCenter: invoice.assignmentCostCenter ?? undefined
    },
    approverNotes: invoice.approverNotes ?? undefined,
    lineItems: invoice.lineItems?.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      category: item.category ?? undefined,
      sortOrder: item.sortOrder ?? 0
    })),
    attachments: invoice.attachments?.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size ?? undefined,
      s3Key: attachment.s3Key
    })),
    createdAt: invoice.createdAt ?? undefined,
    updatedAt: invoice.updatedAt ?? undefined
  };
}

function encodeCursor(input: { id: string; createdAt: number }) {
  const value = `${input.createdAt}|${input.id}`;
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string) {
  try {
    const decoded = Buffer.from(cursor, 'base64url')
      .toString('utf8')
      .split('|');
    if (decoded.length !== 2) {
      return null;
    }
    const createdAt = Number(decoded[0]);
    const id = decoded[1];
    if (Number.isNaN(createdAt) || !id) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}

