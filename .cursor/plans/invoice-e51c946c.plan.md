<!-- e51c946c-fa06-4459-bd9f-9ff756c4d4ee 11eb94a8-42a7-45f5-8c92-016180fbf100 -->
# InvoiceFlow API (Hono + Drizzle + Turso)

## Stack & Runtime

- Hono (TypeScript) on Vercel Functions, Node runtime (not Edge)
- Drizzle ORM with Turso (libSQL)
- AWS S3 for attachment storage (pre-signed upload + read)
- OpenAI (Vision) for extraction; Zod to validate structured output

## Directory & Key Files

- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/package.json` – scripts, deps
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/tsconfig.json` – TS config
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/vercel.json` – Node runtime, routing
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/drizzle.config.ts` – drizzle-kit config (libsql)
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/drizzle/` – migrations output
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/src/db/schema.ts` – Drizzle schema (invoices, line_items, attachments)
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/src/db/client.ts` – libSQL client + Drizzle
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/src/lib/openai.ts` – OpenAI client + extraction helper
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/src/lib/s3.ts` – S3 client + presign helpers
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/src/routes/invoices.ts` – invoice routes
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/src/routes/attachments.ts` – S3 presign route
- `/Users/samuelasvanyi/dev/InvoiceFlow-AI/api/index.ts` – Hono app entry (Vercel handler)

## Data Model (initial)

- invoices: id (ulid), emailId?, status (pending|approved|rejected|clarification_needed), vendorName, vendorTaxId?, invoiceNumber, invoiceDate, dueDate?, currency, subtotal?, taxAmount?, totalAmount, createdAt, updatedAt
- invoice_line_items: id, invoiceId (FK), description, quantity, unitPrice, amount, category?
- attachments: id, invoiceId (FK), s3Key, filename, mimeType, size, createdAt

## Endpoints (v1)

- GET `/api/health` → { ok: true }
- POST `/api/attachments/presign` → { key, uploadUrl, expiresIn }
  - body: { filename, contentType }
- POST `/api/invoices/process` → extract + persist
  - body: { content?: string, attachmentKeys?: string[] }
- GET `/api/invoices` (query: status?, vendor?, q?, cursor?)
- GET `/api/invoices/:id`
- PATCH `/api/invoices/:id` (status updates, approver notes)

## OpenAI Extraction Flow

- Build system prompt + user content
- For each `attachmentKey`, generate pre-signed GET URL; add to messages as `image_url`
- Request `gpt-4o` (Node) with `response_format: json` and validate via Zod
- Persist invoice + line items; link attachments

Example (concise):

```ts
const messages = [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: content || '' },
  ...imageUrls.map(u => ({ role: 'user', content: [{ type: 'image_url', image_url: { url: u }}] }))
];
```

## S3 Upload Flow

- Client requests POST `/attachments/presign`
- Receives `{ key, uploadUrl }`; performs direct PUT to S3
- Server later uses pre-signed GET (short-lived) for OpenAI image access

## Validation & Errors

- Use `zod` and `@hono/zod-validator` for bodies/params
- Return typed error shapes; guard S3 content types and max size via metadata

## Env Vars (Vercel)

- OPENAI_API_KEY
- TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
- AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME
- APP_URL (for absolute links if needed)

## Local Dev & Migrations

- drizzle-kit generate migrations from `schema.ts` → `/drizzle`
- Run push/migrate locally; Turso remote DB reflects schema
- Add `dev` script to run a local server via `hono`/`ts-node` (optional)

## Deployment

- `vercel.json` points `api/index.ts` as function entry; runtime nodejs20/22
- Set env vars in Vercel; no secrets in repo
- Turso connection over TLS; no migrations at runtime in prod

## Security Baseline

- CORS narrowed to app origin
- Input validation, safe JSON parsing, capped payload sizes
- S3 keys are opaque; pre-signed URLs are short-lived
- Minimal logs; no PII in logs

### To-dos

- [ ] Initialize TypeScript project, tsconfig, package.json, vercel.json
- [ ] Add Hono, Drizzle, Turso client, OpenAI, AWS S3 SDK, Zod
- [ ] Implement Drizzle schema for invoices, line items, attachments
- [ ] Create Turso libsql client and Drizzle instance
- [ ] Implement /attachments/presign route with validation
- [ ] Implement OpenAI extraction helper with Zod validation
- [ ] Implement /invoices endpoints (process, list, get, patch)
- [ ] Create Hono app, mount routes, export Vercel handler
- [ ] Configure drizzle-kit and generate initial migrations
- [ ] Configure Vercel runtime, env vars, and deploy