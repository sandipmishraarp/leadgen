CREATE TABLE IF NOT EXISTS "email_engagements" (
  "id" TEXT NOT NULL,
  "sentEmailId" TEXT NOT NULL,
  "deliveryStatus" TEXT NOT NULL DEFAULT 'ACCEPTED',
  "deliveredAt" TIMESTAMP(3),
  "openCount" INTEGER NOT NULL DEFAULT 0,
  "firstOpenAt" TIMESTAMP(3),
  "lastOpenAt" TIMESTAMP(3),
  "clickedLinks" INTEGER NOT NULL DEFAULT 0,
  "lastClickedAt" TIMESTAMP(3),
  "websiteVisits" INTEGER NOT NULL DEFAULT 0,
  "proposalViews" INTEGER NOT NULL DEFAULT 0,
  "engagementScore" INTEGER NOT NULL DEFAULT 0,
  "leadScore" TEXT NOT NULL DEFAULT 'Cold',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_engagements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "link_clicks" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "referrer" TEXT,
  "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "website_visits" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT,
  "leadId" TEXT,
  "email" TEXT,
  "pageUrl" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "referrer" TEXT,
  "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "website_visits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "proposal_views" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT,
  "sentEmailId" TEXT,
  "leadId" TEXT,
  "proposalId" TEXT,
  "proposalUrl" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "referrer" TEXT,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_engagements_sentEmailId_key" ON "email_engagements"("sentEmailId");
CREATE INDEX IF NOT EXISTS "email_engagements_leadScore_engagementScore_idx" ON "email_engagements"("leadScore", "engagementScore");
CREATE INDEX IF NOT EXISTS "link_clicks_engagementId_clickedAt_idx" ON "link_clicks"("engagementId", "clickedAt");
CREATE INDEX IF NOT EXISTS "website_visits_engagementId_visitedAt_idx" ON "website_visits"("engagementId", "visitedAt");
CREATE INDEX IF NOT EXISTS "website_visits_leadId_visitedAt_idx" ON "website_visits"("leadId", "visitedAt");
CREATE INDEX IF NOT EXISTS "proposal_views_engagementId_viewedAt_idx" ON "proposal_views"("engagementId", "viewedAt");
CREATE INDEX IF NOT EXISTS "proposal_views_leadId_viewedAt_idx" ON "proposal_views"("leadId", "viewedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_engagements_sentEmailId_fkey'
  ) THEN
    ALTER TABLE "email_engagements"
      ADD CONSTRAINT "email_engagements_sentEmailId_fkey"
      FOREIGN KEY ("sentEmailId") REFERENCES "sent_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'link_clicks_engagementId_fkey'
  ) THEN
    ALTER TABLE "link_clicks"
      ADD CONSTRAINT "link_clicks_engagementId_fkey"
      FOREIGN KEY ("engagementId") REFERENCES "email_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_visits_engagementId_fkey'
  ) THEN
    ALTER TABLE "website_visits"
      ADD CONSTRAINT "website_visits_engagementId_fkey"
      FOREIGN KEY ("engagementId") REFERENCES "email_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_visits_leadId_fkey'
  ) THEN
    ALTER TABLE "website_visits"
      ADD CONSTRAINT "website_visits_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposal_views_engagementId_fkey'
  ) THEN
    ALTER TABLE "proposal_views"
      ADD CONSTRAINT "proposal_views_engagementId_fkey"
      FOREIGN KEY ("engagementId") REFERENCES "email_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposal_views_sentEmailId_fkey'
  ) THEN
    ALTER TABLE "proposal_views"
      ADD CONSTRAINT "proposal_views_sentEmailId_fkey"
      FOREIGN KEY ("sentEmailId") REFERENCES "sent_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposal_views_leadId_fkey'
  ) THEN
    ALTER TABLE "proposal_views"
      ADD CONSTRAINT "proposal_views_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
