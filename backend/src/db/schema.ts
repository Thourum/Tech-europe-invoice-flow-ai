import { sql } from 'drizzle-orm';
import {
  integer,
  real,
  sqliteTable,
  text
} from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const invoiceStatusOptions = [
  'pending',
  'approved',
  'rejected',
  'clarification_needed'
] as const;

export type InvoiceStatus = typeof invoiceStatusOptions[number];

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  emailId: text('email_id'),
  status: text('status', {
    enum: invoiceStatusOptions
  })
    .notNull()
    .default('pending'),
  vendorName: text('vendor_name').notNull(),
  vendorTaxId: text('vendor_tax_id'),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceDate: text('invoice_date').notNull(),
  dueDate: text('due_date'),
  currency: text('currency').notNull().default('USD'),
  subtotal: real('subtotal'),
  taxAmount: real('tax_amount'),
  totalAmount: real('total_amount').notNull(),
  assignmentDepartment: text('assignment_department'),
  assignmentEmployee: text('assignment_employee'),
  assignmentCostCenter: text('assignment_cost_center'),
  approverNotes: text('approver_notes'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => sql`(unixepoch() * 1000)`)
});

export const invoiceLineItems = sqliteTable('invoice_line_items', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unitPrice: real('unit_price').notNull(),
  amount: real('amount').notNull(),
  category: text('category'),
  sortOrder: integer('sort_order').default(0),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const invoiceLineItemRelations = relations(
  invoiceLineItems,
  ({ one }) => ({
    invoice: one(invoices, {
      fields: [invoiceLineItems.invoiceId],
      references: [invoices.id]
    })
  })
);

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const attachmentRelations = relations(attachments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [attachments.invoiceId],
    references: [invoices.id]
  })
}));

export const invoiceRelations = relations(invoices, ({ many }) => ({
  lineItems: many(invoiceLineItems),
  attachments: many(attachments)
}));

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

