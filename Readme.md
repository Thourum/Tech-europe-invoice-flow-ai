## InvoiceFlow AI Backend

Node-based Hono API for processing invoices with OpenAI extraction, Turso storage (libSQL + Drizzle), and AWS S3 attachment handling. Deploy-ready for Vercel Functions (Node runtime).

### Features

- REST endpoints for invoice ingestion, listing, retrieval, and status updates
- OpenAI GPT-4o-based extraction with Zod validation
- Turso (libSQL) persistence with Drizzle ORM and migrations
- AWS S3 pre-signed uploads & downloads for invoice attachments
- Vercel compatible deployment with Node runtime

### Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Copy environment template**
   ```bash
   cp env.sample .env.local
   ```
   Fill in the required secrets (see `env.sample` for variable descriptions).

3. **Run database migrations**
   ```bash
   npm run drizzle:migrate
   ```
   (Requires valid `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` or adjust to local `file:` database.)

4. **Start the local API**
   ```bash
   npm run dev
   ```
   Served at `http://localhost:3000`.

### Key Scripts

- `npm run dev` – start local Hono server
- `npm run build` – compile TypeScript to `dist`
- `npm run drizzle:generate` – generate SQL migrations from schema
- `npm run drizzle:migrate` – apply migrations
- `npm run drizzle:studio` – open Drizzle Studio UI

### Deployment

Deploy via Vercel (Node runtime). Ensure environment variables are configured in the Vercel dashboard:

- `OPENAI_API_KEY`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`
- `APP_URL` (public URL used in notifications / links)

### API Overview

- `GET /api/health` – service health check
- `POST /api/attachments/presign` – pre-signed S3 PUT URL
- `POST /api/invoices/process` – run OpenAI extraction and persist invoice
- `GET /api/invoices` – list invoices with filters & cursor pagination
- `GET /api/invoices/:id` – fetch invoice with line items & attachments
- `PATCH /api/invoices/:id` – update status / approver notes

### Testing & Tooling

- `drizzle/` contains generated SQL migrations
- `src/app.ts` exports the Hono app (shared between local + Vercel)
- `src/routes/` organizes route modules
- `src/lib/` holds integrations (OpenAI, S3)
- `src/db/` contains schema definitions and Drizzle client setup
