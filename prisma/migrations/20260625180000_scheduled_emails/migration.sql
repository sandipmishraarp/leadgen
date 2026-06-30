ALTER TYPE "DraftStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

CREATE TABLE IF NOT EXISTS "scheduled_emails" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "draftId" TEXT,
  "fromEmail" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "cc" TEXT,
  "bcc" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "clientTimezone" TEXT,
  "clientLocalScheduledAt" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "trackingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "failureReason" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scheduled_emails_status_scheduledAt_idx" ON "scheduled_emails"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "scheduled_emails_leadId_createdAt_idx" ON "scheduled_emails"("leadId", "createdAt");

ALTER TABLE "scheduled_emails"
  ADD CONSTRAINT "scheduled_emails_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_emails"
  ADD CONSTRAINT "scheduled_emails_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
