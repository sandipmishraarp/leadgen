ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "followupState" TEXT,
  ADD COLUMN IF NOT EXISTS "followupStateUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "followupDraftId" TEXT,
  ADD COLUMN IF NOT EXISTS "followupScheduledEmailId" TEXT;

CREATE INDEX IF NOT EXISTS "leads_followupState_nextFollowUpAt_idx" ON "leads"("followupState", "nextFollowUpAt");
