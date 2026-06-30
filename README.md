# AI Sales Email Agent Phase 1

Approval-based MVP for AResourcePool sales email replies.

## Phase 1 Features

- Admin login for MVP dashboard access.
- 20i IMAP inbox sync for `abhay@aresourcepool.com`.
- Inbox dashboard with email threads grouped by lead.
- Full thread reader.
- OpenAI draft generation in AResourcePool / Abhay Kumar sales tone.
- Editable draft review screen.
- `Approve & Send` workflow using 20i SMTP.
- PostgreSQL persistence for users, email accounts, leads, threads, emails, drafts, sent emails, prompts, and activity logs.
- Lead statuses: New, Draft Created, Replied, Follow-up Needed, Won, Lost.

Chrome extension and full auto-send are intentionally not included in this phase.

## Stack

- Next.js App Router, React, TypeScript
- Tailwind CSS
- PostgreSQL
- Prisma
- OpenAI API
- IMAP via `imapflow`
- SMTP via `nodemailer`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Start local PostgreSQL:

```bash
docker compose up -d
```

4. Fill in `.env`:

```bash
OPENAI_API_KEY=...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_sales_agent
IMAP_HOST=...
IMAP_PORT=993
IMAP_USER=abhay@aresourcepool.com
IMAP_PASSWORD=...
SMTP_HOST=...
SMTP_PORT=465
SMTP_USER=abhay@aresourcepool.com
SMTP_PASSWORD=...
APP_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@aresourcepool.com
ADMIN_PASSWORD=ChangeMe123!
```

5. Create and migrate the database:

```bash
npm run prisma:migrate
```

6. Seed the admin user and default AI prompt:

```bash
npm run prisma:seed
```

7. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000/login` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Workflow

1. Open Settings and verify IMAP/SMTP credentials.
2. Open Dashboard or Inbox and click `Sync Inbox`.
3. Open a thread from the Inbox.
4. Click `Generate AI Draft`.
5. Edit the draft.
6. Click `Approve & Send`.

The backend sends only after the explicit `Approve & Send` action. Generated drafts are never sent automatically.

## Database

Prisma schema: `prisma/schema.prisma`

Initial SQL migration: `prisma/migrations/20260624150000_init/migration.sql`

Important tables:

- `users`
- `email_accounts`
- `leads`
- `email_threads`
- `emails`
- `drafts`
- `sent_emails`
- `ai_prompts`
- `activity_logs`

## API Routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/dashboard`
- `GET /api/inbox`
- `GET /api/threads/:id`
- `POST /api/mail/sync`
- `POST /api/mail/test-connection`
- `POST /api/drafts/generate`
- `PATCH /api/drafts/:id`
- `POST /api/drafts/:id/approve-send`
- `GET /api/leads`
- `PATCH /api/leads/:id`
- `GET /api/settings`
- `POST /api/settings`

## Security Notes

- IMAP and SMTP passwords are encrypted before database storage using `APP_SECRET`.
- OpenAI API keys can be set in `.env` or saved from Settings; saved keys are encrypted before database storage.
- Credentials are never returned to the frontend.
- SMTP sending is backend-only.
- Every important action is written to `activity_logs`.
- Use HTTPS and a strong `APP_SECRET` in deployed environments.
