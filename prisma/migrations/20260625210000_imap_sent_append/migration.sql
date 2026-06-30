ALTER TABLE "sent_emails"
  ADD COLUMN IF NOT EXISTS "imapUid" TEXT,
  ADD COLUMN IF NOT EXISTS "sentFolder" TEXT,
  ADD COLUMN IF NOT EXISTS "appendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "appendStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "appendError" TEXT,
  ADD COLUMN IF NOT EXISTS "rawMime" TEXT;

CREATE INDEX IF NOT EXISTS "sent_emails_appendStatus_idx" ON "sent_emails"("appendStatus");
