ALTER TABLE "email_accounts"
  ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'Sales',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "lastTestAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "folderConfig" JSONB,
  ADD COLUMN IF NOT EXISTS "schedulerConfig" JSONB,
  ADD COLUMN IF NOT EXISTS "importStats" JSONB,
  ADD COLUMN IF NOT EXISTS "connectionStatus" JSONB;

CREATE INDEX IF NOT EXISTS "email_accounts_role_status_idx" ON "email_accounts"("role", "status");
