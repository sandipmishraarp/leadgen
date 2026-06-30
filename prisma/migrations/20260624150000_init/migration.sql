CREATE TYPE "UserRole" AS ENUM ('ADMIN');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'DRAFT_CREATED', 'REPLIED', 'FOLLOW_UP_NEEDED', 'WON', 'LOST');
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'DISCARDED');
CREATE TYPE "ActivityType" AS ENUM ('LOGIN', 'SETTINGS_UPDATED', 'MAIL_SYNC', 'DRAFT_GENERATED', 'DRAFT_UPDATED', 'DRAFT_APPROVED', 'EMAIL_SENT', 'LEAD_STATUS_CHANGED', 'ERROR');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_accounts" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'AResourcePool 20i',
  "emailAddress" TEXT NOT NULL,
  "imapHost" TEXT NOT NULL,
  "imapPort" INTEGER NOT NULL DEFAULT 993,
  "imapSecure" BOOLEAN NOT NULL DEFAULT true,
  "imapUser" TEXT NOT NULL,
  "imapPasswordEncrypted" TEXT NOT NULL,
  "smtpHost" TEXT NOT NULL,
  "smtpPort" INTEGER NOT NULL DEFAULT 465,
  "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
  "smtpUser" TEXT NOT NULL,
  "smtpPasswordEncrypted" TEXT NOT NULL,
  "openaiApiKeyEncrypted" TEXT,
  "fromName" TEXT NOT NULL DEFAULT 'Abhay Kumar',
  "fromTitle" TEXT NOT NULL DEFAULT 'Sales & Marketing Director',
  "fromCompany" TEXT NOT NULL DEFAULT 'AResourcePool',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leads" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT NOT NULL,
  "company" TEXT,
  "phone" TEXT,
  "source" TEXT NOT NULL DEFAULT 'email',
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "notes" TEXT,
  "lastContactedAt" TIMESTAMP(3),
  "nextFollowUpAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_threads" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "leadId" TEXT,
  "subject" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "lastMessageAt" TIMESTAMP(3),
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "emails" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "direction" "EmailDirection" NOT NULL DEFAULT 'INBOUND',
  "messageId" TEXT NOT NULL,
  "inReplyTo" TEXT,
  "references" TEXT,
  "fromName" TEXT,
  "fromEmail" TEXT NOT NULL,
  "toEmails" TEXT[],
  "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "subject" TEXT NOT NULL,
  "snippet" TEXT,
  "textBody" TEXT,
  "htmlBody" TEXT,
  "attachmentMetadata" JSONB,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drafts" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "sourceEmailId" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "aiModel" TEXT,
  "promptVersion" TEXT,
  "confidence" DOUBLE PRECISION,
  "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sent_emails" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "draftId" TEXT,
  "providerId" TEXT,
  "toEmails" TEXT[],
  "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sent_emails_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompts" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "systemText" TEXT NOT NULL,
  "userText" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "activity_logs" (
  "id" TEXT NOT NULL,
  "type" "ActivityType" NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "userId" TEXT,
  "leadId" TEXT,
  "threadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "email_accounts_emailAddress_key" ON "email_accounts"("emailAddress");
CREATE UNIQUE INDEX "leads_email_key" ON "leads"("email");
CREATE UNIQUE INDEX "email_threads_accountId_normalizedKey_key" ON "email_threads"("accountId", "normalizedKey");
CREATE UNIQUE INDEX "emails_messageId_key" ON "emails"("messageId");
CREATE INDEX "emails_threadId_sentAt_idx" ON "emails"("threadId", "sentAt");
CREATE UNIQUE INDEX "sent_emails_draftId_key" ON "sent_emails"("draftId");
CREATE UNIQUE INDEX "ai_prompts_name_version_key" ON "ai_prompts"("name", "version");
CREATE INDEX "activity_logs_type_createdAt_idx" ON "activity_logs"("type", "createdAt");

ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emails" ADD CONSTRAINT "emails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emails" ADD CONSTRAINT "emails_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
