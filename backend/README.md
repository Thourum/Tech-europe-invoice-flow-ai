## InvoiceFlow AI Backend

Node-based Hono API for processing invoices with OpenAI extraction, Turso storage (libSQL + Drizzle), Better Auth sessions, and Vercel Blob attachment handling. Deploy-ready for Vercel Functions (Node runtime).

### Features

- REST endpoints for invoice ingestion, listing, retrieval, and status updates
- Better Auth-powered session authentication
- OpenAI GPT-4o-based extraction with Zod validation
- Turso (libSQL) persistence with Drizzle ORM and migrations
- Vercel Blob pre-signed uploads & downloads for invoice attachments
- Gmail OAuth integration to surface invoice emails (metadata pipeline)
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
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `APP_URL` (public URL used for redirects / notifications)

### API Overview

- `GET /health` – service health check
- `POST /attachments/presign` – pre-signed upload URL via Vercel Blob
- `POST /invoices/process` – run OpenAI extraction and persist invoice
- `GET /invoices` – list invoices with filters & cursor pagination
- `GET /invoices/:id` – fetch invoice with line items & attachments
- `PATCH /invoices/:id` – update status / approver notes
- `POST /api/gmail/link` – initiate Gmail OAuth (auth required)
- `GET /api/gmail/oauth/callback` – persist Gmail account tokens
- `POST /api/gmail/check` – list recent Gmail messages with invoice-like attachments
- Better Auth routes are available under `/api/auth/*` (sign-in, sign-up, sessions, etc.)

### Testing & Tooling

- `drizzle/` contains generated SQL migrations
- `src/app.ts` exports the Hono app (shared between local + Vercel)
- `src/routes/` organizes route modules
- `src/lib/` holds integrations (OpenAI, S3)
- `src/db/` contains schema definitions and Drizzle client setup
