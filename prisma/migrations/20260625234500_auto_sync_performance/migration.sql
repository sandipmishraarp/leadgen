-- Incremental email sync state and background sync jobs.
CREATE TABLE IF NOT EXISTS "email_folder_sync_states" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "folderPath" TEXT NOT NULL,
  "folderRole" TEXT,
  "lastUid" INTEGER NOT NULL DEFAULT 0,
  "highestUid" INTEGER NOT NULL DEFAULT 0,
  "uidValidity" INTEGER,
  "lastSyncedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_folder_sync_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sync_jobs" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "accountEmail" TEXT,
  "jobType" TEXT NOT NULL DEFAULT 'AUTO_SYNC',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "currentFolderPath" TEXT,
  "batchSize" INTEGER NOT NULL DEFAULT 100,
  "concurrency" INTEGER NOT NULL DEFAULT 2,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "remainingCount" INTEGER NOT NULL DEFAULT 0,
  "speedPerMinute" DOUBLE PRECISION,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "imapUid" INTEGER;
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "duplicateHash" TEXT;

UPDATE "email_accounts"
SET
  "autoSyncEnabled" = TRUE,
  "schedulerConfig" = COALESCE("schedulerConfig", '{}'::jsonb) || jsonb_build_object(
    'syncInterval',
    CASE WHEN "accountType" = 'LEAD_INTAKE' OR "role" = 'Lead Intake' THEN 'EVERY_15_MIN' ELSE 'EVERY_5_MIN' END,
    'batchSize', 100,
    'concurrency', 2,
    'autoSyncEnabled', TRUE
  )
WHERE "isActive" = TRUE
  AND ("schedulerConfig" IS NULL OR "schedulerConfig"->>'syncInterval' IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "email_folder_sync_states_accountId_folderPath_key" ON "email_folder_sync_states"("accountId", "folderPath");
CREATE INDEX IF NOT EXISTS "email_folder_sync_states_accountId_status_idx" ON "email_folder_sync_states"("accountId", "status");
CREATE INDEX IF NOT EXISTS "email_folder_sync_states_accountEmail_folderPath_idx" ON "email_folder_sync_states"("accountEmail", "folderPath");

CREATE INDEX IF NOT EXISTS "sync_jobs_status_nextRunAt_idx" ON "sync_jobs"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "sync_jobs_accountId_createdAt_idx" ON "sync_jobs"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "sync_jobs_accountEmail_status_idx" ON "sync_jobs"("accountEmail", "status");

CREATE INDEX IF NOT EXISTS "emails_accountId_sourceFolderPath_imapUid_idx" ON "emails"("accountId", "sourceFolderPath", "imapUid");
CREATE INDEX IF NOT EXISTS "emails_accountId_duplicateHash_idx" ON "emails"("accountId", "duplicateHash");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_folder_sync_states_accountId_fkey'
  ) THEN
    ALTER TABLE "email_folder_sync_states"
      ADD CONSTRAINT "email_folder_sync_states_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sync_jobs_accountId_fkey'
  ) THEN
    ALTER TABLE "sync_jobs"
      ADD CONSTRAINT "sync_jobs_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
