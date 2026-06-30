ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REPLY';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CLIENT_REPLIED';

ALTER TABLE "lead_intake"
  ADD COLUMN IF NOT EXISTS "originalClientName" TEXT,
  ADD COLUMN IF NOT EXISTS "originalClientEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "originalClientPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "originalWebsite" TEXT,
  ADD COLUMN IF NOT EXISTS "originalCompany" TEXT,
  ADD COLUMN IF NOT EXISTS "originalSubject" TEXT,
  ADD COLUMN IF NOT EXISTS "originalConversationText" TEXT,
  ADD COLUMN IF NOT EXISTS "latestClientMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "previousProviderMessages" TEXT,
  ADD COLUMN IF NOT EXISTS "fullForwardedChain" TEXT,
  ADD COLUMN IF NOT EXISTS "detectedIntent" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "recommendedReplyType" TEXT,
  ADD COLUMN IF NOT EXISTS "forwardedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "providerEmail" TEXT;

CREATE INDEX IF NOT EXISTS "lead_intake_detectedIntent_idx" ON "lead_intake"("detectedIntent");
