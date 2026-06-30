ALTER TABLE "lead_intake"
  ADD COLUMN IF NOT EXISTS "originalClientMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "confirmedClientEmailAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedClientEmailBy" TEXT;

UPDATE "lead_intake"
SET "originalClientMessage" = "forwardedClientMessage"
WHERE "originalClientMessage" IS NULL
  AND "forwardedClientMessage" IS NOT NULL;
