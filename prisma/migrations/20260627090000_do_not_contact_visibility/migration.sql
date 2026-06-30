ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "communicationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "blockReason" TEXT,
  ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_communicationStatus_blockedAt_idx" ON "leads"("communicationStatus", "blockedAt");
