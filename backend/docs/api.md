# InvoiceFlow API Documentation

This document describes the public HTTP endpoints exposed by the InvoiceFlow backend.

## Base URL

- Development: `http://localhost:3000`
- Production: `https://invoiceflow.example.com`

All endpoints accept and return JSON unless otherwise stated.

---

## Health

### `GET /health`

Simple heartbeat endpoint.

- **Response** `200 OK`

```json
{ "ok": true }
```

---

## Authentication (Better Auth)

Better Auth routes are exposed under `/api/auth/*`. Refer to the
[Better Auth documentation](https://www.better-auth.com/docs/installation) for the
full list of available handlers. Common routes include:

- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-out`
- `GET /api/auth/get-session`

All authentication endpoints manage session cookies automatically.

---

## Attachments

### `POST /attachments/presign`

Generate a pre-signed upload URL for invoice attachments (PDF or image files).

- **Request Body**

```json
{
  "filename": "invoice.pdf",
  "contentType": "application/pdf",
  "size": 123456   // optional, in bytes
}
```

- **Response** `200 OK`

```json
{
  "key": "attachments/01JD...-invoice.pdf",
  "url": "https://...",
  "fields": { "key": "value" },
  "maxSize": 26214400
}
```

- **Errors**
  - `400` if file type or size is invalid.

---

## Invoices

### `POST /invoices/process`

Trigger AI extraction for an invoice and persist results.

- **Request Body**

```json
{
  "emailId": "1781617395802525",     // optional
  "content": "Email body text",       // optional
  "attachments": [
    {
      "key": "attachments/01JD...-invoice.pdf",
      "filename": "invoice.pdf",
      "contentType": "application/pdf",
      "size": 123456                  // optional
    }
  ]
}
```

Either `content` or `attachments` must be provided.

- **Response** `200 OK`

```json
{
  "invoice": { "...": "..." },
  "extraction": { "...": "..." }
}
```

---

## Gmail Integration

### `POST /integrations/gmail/link`

Initiate the Gmail OAuth consent flow for the authenticated user.

- **Authentication**: Required (Better Auth session cookie)
- **Response** `200 OK`

```json
{
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "eyJ2Ijoi... (base64url)",
  "expiresIn": 900
}
```

The client should redirect the user to `authorizationUrl`. `state` must be
preserved and returned to the callback untouched.

### `GET /integrations/gmail/oauth/callback`

OAuth callback endpoint that is invoked by Google after user consent.

- **Query Parameters**
  - `code` – authorization code (required)
  - `state` – opaque state issued by `/integrations/gmail/link` (required)
  - `error` – present when Google denies access (optional)
  - `redirect` – optional relative URL to redirect after successful linkage

- **Success Response** `200 OK`

```json
{
  "success": true,
  "email": "user@example.com",
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "expiresAt": 1731022222520
}
```

- **Redirect behaviour**: When `redirect` is supplied, the user is redirected to
  that path (relative to `APP_URL`) with `status=linked` and the account email in
  the query string.

### `POST /integrations/gmail/check`

Fetch recent Gmail messages that are likely to contain invoices. OCR is _not_
invoked yet; only metadata is returned.

- **Authentication**: Required (Better Auth session cookie)
- **Request Body (optional)**

```json
{
  "maxResults": 5,                  // optional, defaults to 5, max 50
  "query": "has:attachment ..."     // optional Gmail search query
}
```

- **Response** `200 OK`

```json
{
  "messages": [
    {
      "id": "17ab4fa0e5071b70",
      "threadId": "17ab4fa0e5071b70",
      "historyId": "22540",
      "subject": "ACME Corp Invoice 2025-11",
      "from": "billing@acme.com",
      "receivedAt": 1731069834000,
      "snippet": "Hi team, please find the invoice attached...",
      "attachmentCount": 1,
      "attachments": [
        {
          "attachmentId": "ANGjdJ9IYc...",
          "filename": "acme-invoice-2025-11.pdf",
          "mimeType": "application/pdf",
          "size": 152034
        }
      ]
    }
  ]
}
```

- **Errors**
  - `400` if the Gmail account has not been linked.
  - `401` if the session is missing/expired.
  - `500` for unexpected Gmail API errors.

---

## Error Format

Unless stated otherwise, error responses use the structure:

```json
{
  "error": "Message",
  "issues": [ ... ]   // optional, for validation errors
}
```

---

## Rate Limits & Retries

- Gmail endpoints rely on Google OAuth tokens; repeated failures will surface
  Google error codes directly. Add exponential backoff when polling.
- Attachments presign endpoint enforces MIME type and size limits server-side.

---

## Future Work

- OCR pipeline integration for Gmail metadata (`/integrations/gmail/check`).
- Background job orchestration for scheduled Gmail polling.


