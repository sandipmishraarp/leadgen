ALTER TABLE "drafts"
  ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT,
  ADD COLUMN IF NOT EXISTS "bodyText" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentMetadata" JSONB;

ALTER TABLE "scheduled_emails"
  ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT,
  ADD COLUMN IF NOT EXISTS "bodyText" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentMetadata" JSONB;

ALTER TABLE "sent_emails"
  ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT,
  ADD COLUMN IF NOT EXISTS "bodyText" TEXT;

CREATE TABLE IF NOT EXISTS "email_signatures" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "name" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "plainText" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_signatures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subject" TEXT,
  "html" TEXT NOT NULL,
  "plainText" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_signatures_accountId_isDefault_idx" ON "email_signatures"("accountId", "isDefault");
CREATE INDEX IF NOT EXISTS "email_templates_category_usageCount_idx" ON "email_templates"("category", "usageCount");

ALTER TABLE "email_signatures"
  ADD CONSTRAINT "email_signatures_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "drafts"
SET "bodyText" = "body",
    "bodyHtml" = '<p>' || replace(replace(replace("body", '&', '&amp;'), '<', '&lt;'), E'\n', '<br>') || '</p>'
WHERE "bodyText" IS NULL;

UPDATE "scheduled_emails"
SET "bodyText" = "body",
    "bodyHtml" = '<p>' || replace(replace(replace("body", '&', '&amp;'), '<', '&lt;'), E'\n', '<br>') || '</p>'
WHERE "bodyText" IS NULL;
