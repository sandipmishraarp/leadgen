CREATE TABLE IF NOT EXISTS "automation_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "autoClassifyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "autoCreateReplyDrafts" BOOLEAN NOT NULL DEFAULT false,
  "autoCreateFollowupDrafts" BOOLEAN NOT NULL DEFAULT false,
  "autoBlockDoNotContact" BOOLEAN NOT NULL DEFAULT true,
  "autoSuggestSchedule" BOOLEAN NOT NULL DEFAULT true,
  "followup1Days" INTEGER NOT NULL DEFAULT 3,
  "followup2Days" INTEGER NOT NULL DEFAULT 7,
  "followup3Days" INTEGER NOT NULL DEFAULT 14,
  "finalFollowupDays" INTEGER NOT NULL DEFAULT 21,
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
);
