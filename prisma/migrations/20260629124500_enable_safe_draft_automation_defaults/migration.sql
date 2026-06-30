ALTER TABLE "automation_settings"
ALTER COLUMN "autoCreateReplyDrafts" SET DEFAULT true,
ALTER COLUMN "autoCreateFollowupDrafts" SET DEFAULT true;

INSERT INTO "automation_settings" ("id", "autoCreateReplyDrafts", "autoCreateFollowupDrafts", "updatedAt")
VALUES ('default', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "autoCreateReplyDrafts" = true,
  "autoCreateFollowupDrafts" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
