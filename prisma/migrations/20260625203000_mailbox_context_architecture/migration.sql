ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "assignedEmailAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedUser" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assignedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "currentMailbox" TEXT;

CREATE INDEX IF NOT EXISTS "leads_assignedEmailAccount_idx" ON "leads"("assignedEmailAccount");
CREATE INDEX IF NOT EXISTS "leads_currentMailbox_status_idx" ON "leads"("currentMailbox", "status");
