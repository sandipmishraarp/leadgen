CREATE INDEX IF NOT EXISTS "leads_company_idx" ON "leads"("company");
CREATE INDEX IF NOT EXISTS "leads_website_idx" ON "leads"("website");
CREATE INDEX IF NOT EXISTS "leads_status_updatedAt_idx" ON "leads"("status", "updatedAt");

CREATE INDEX IF NOT EXISTS "lead_intake_accountEmail_receivedAt_idx" ON "lead_intake"("accountEmail", "receivedAt");
CREATE INDEX IF NOT EXISTS "lead_intake_sourceFolderPath_receivedAt_idx" ON "lead_intake"("sourceFolderPath", "receivedAt");
CREATE INDEX IF NOT EXISTS "lead_intake_subject_idx" ON "lead_intake"("subject");
CREATE INDEX IF NOT EXISTS "lead_intake_fromEmail_idx" ON "lead_intake"("fromEmail");
CREATE INDEX IF NOT EXISTS "lead_intake_extractedCompany_idx" ON "lead_intake"("extractedCompany");
CREATE INDEX IF NOT EXISTS "lead_intake_extractedWebsite_idx" ON "lead_intake"("extractedWebsite");

CREATE INDEX IF NOT EXISTS "emails_accountId_folder_sentAt_idx" ON "emails"("accountId", "folder", "sentAt");
CREATE INDEX IF NOT EXISTS "emails_fromEmail_idx" ON "emails"("fromEmail");
CREATE INDEX IF NOT EXISTS "emails_normalizedSubject_idx" ON "emails"("normalizedSubject");
CREATE INDEX IF NOT EXISTS "emails_subject_idx" ON "emails"("subject");
