ALTER TABLE "emails"
  ADD COLUMN IF NOT EXISTS "sourceFolder" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceFolderPath" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceProviderName" TEXT;

ALTER TABLE "lead_intake"
  ADD COLUMN IF NOT EXISTS "accountEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceFolder" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceFolderPath" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceProviderName" TEXT,
  ADD COLUMN IF NOT EXISTS "detectedProviderName" TEXT,
  ADD COLUMN IF NOT EXISTS "parsingStatus" TEXT NOT NULL DEFAULT 'PARSED';

UPDATE "lead_intake"
SET
  "accountEmail" = COALESCE("accountEmail", "email_accounts"."emailAddress"),
  "sourceFolder" = COALESCE("sourceFolder", 'INBOX'),
  "sourceFolderPath" = COALESCE("sourceFolderPath", 'INBOX')
FROM "email_accounts"
WHERE "lead_intake"."accountId" = "email_accounts"."id";

DROP INDEX IF EXISTS "lead_intake_messageId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "lead_intake_accountEmail_sourceFolderPath_messageId_key"
  ON "lead_intake"("accountEmail", "sourceFolderPath", "messageId");

CREATE TABLE IF NOT EXISTS "lead_import_jobs" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "selectedFolders" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "batchSize" INTEGER NOT NULL DEFAULT 50,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "currentFolderPath" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_import_folders" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "folderName" TEXT NOT NULL,
  "folderPath" TEXT NOT NULL,
  "sourceProviderName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastUidImported" INTEGER NOT NULL DEFAULT 0,
  "uidValidity" INTEGER,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_import_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_import_jobs_accountId_status_idx"
  ON "lead_import_jobs"("accountId", "status");

CREATE INDEX IF NOT EXISTS "lead_import_jobs_createdAt_idx"
  ON "lead_import_jobs"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "lead_import_folders_jobId_folderPath_key"
  ON "lead_import_folders"("jobId", "folderPath");

CREATE INDEX IF NOT EXISTS "lead_import_folders_accountId_folderPath_idx"
  ON "lead_import_folders"("accountId", "folderPath");

CREATE INDEX IF NOT EXISTS "lead_import_folders_status_updatedAt_idx"
  ON "lead_import_folders"("status", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_import_jobs_accountId_fkey'
  ) THEN
    ALTER TABLE "lead_import_jobs"
      ADD CONSTRAINT "lead_import_jobs_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_import_folders_jobId_fkey'
  ) THEN
    ALTER TABLE "lead_import_folders"
      ADD CONSTRAINT "lead_import_folders_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "lead_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
