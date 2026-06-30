ALTER TABLE "lead_intake"
  ADD COLUMN IF NOT EXISTS "leadSourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "conversationType" TEXT,
  ADD COLUMN IF NOT EXISTS "replyMode" TEXT;

CREATE INDEX IF NOT EXISTS "lead_intake_leadSourceType_idx" ON "lead_intake"("leadSourceType");
CREATE INDEX IF NOT EXISTS "lead_intake_conversationType_idx" ON "lead_intake"("conversationType");
