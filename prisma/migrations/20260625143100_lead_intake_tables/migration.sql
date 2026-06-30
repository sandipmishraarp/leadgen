ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "website" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "service" TEXT,
  ADD COLUMN IF NOT EXISTS "clientEmailConfidence" INTEGER,
  ADD COLUMN IF NOT EXISTS "clientEmailReason" TEXT;

ALTER TABLE "leads"
  ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_SANDIP';

CREATE TABLE IF NOT EXISTS "lead_intake" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "leadId" TEXT,
  "messageId" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "subject" TEXT NOT NULL,
  "rawText" TEXT,
  "rawHtml" TEXT,
  "rawEmail" TEXT,
  "leadGeneratorEmail" TEXT,
  "extractedName" TEXT,
  "extractedClientEmail" TEXT,
  "extractedWebsite" TEXT,
  "extractedPhone" TEXT,
  "extractedCountry" TEXT,
  "extractedService" TEXT,
  "extractedCompany" TEXT,
  "forwardedClientMessage" TEXT,
  "extractionConfidence" INTEGER NOT NULL DEFAULT 0,
  "extractionReason" TEXT,
  "needsManualConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "status" "LeadStatus" NOT NULL DEFAULT 'WAITING_FOR_SANDIP',
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_intake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_intake_messageId_key" ON "lead_intake"("messageId");
CREATE INDEX IF NOT EXISTS "lead_intake_status_receivedAt_idx" ON "lead_intake"("status", "receivedAt");
CREATE INDEX IF NOT EXISTS "lead_intake_extractedClientEmail_idx" ON "lead_intake"("extractedClientEmail");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_intake_accountId_fkey'
  ) THEN
    ALTER TABLE "lead_intake"
      ADD CONSTRAINT "lead_intake_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_intake_leadId_fkey'
  ) THEN
    ALTER TABLE "lead_intake"
      ADD CONSTRAINT "lead_intake_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
