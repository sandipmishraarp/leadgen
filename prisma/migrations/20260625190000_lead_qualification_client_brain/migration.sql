CREATE TABLE IF NOT EXISTS "lead_qualifications" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "classification" TEXT NOT NULL,
  "dealSizeEstimate" INTEGER,
  "winProbability" INTEGER NOT NULL,
  "reasoning" JSONB NOT NULL,
  "recommendedAction" TEXT,
  "confidence" INTEGER,
  "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_qualifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "client_brains" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "firstContactAt" TIMESTAMP(3),
  "interestedService" TEXT,
  "budgetRange" TEXT,
  "objections" JSONB,
  "painPoints" JSONB,
  "proposalHistory" JSONB,
  "preferredTone" TEXT,
  "preferredEmailTime" TEXT,
  "currentTemperature" TEXT,
  "recommendedNextStep" TEXT,
  "summary" TEXT,
  "decisionStage" TEXT,
  "lastImportantEvent" TEXT,
  "nextBestAction" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_brains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_qualifications_leadId_key" ON "lead_qualifications"("leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "client_brains_leadId_key" ON "client_brains"("leadId");
CREATE INDEX IF NOT EXISTS "lead_qualifications_classification_score_idx" ON "lead_qualifications"("classification", "score");
CREATE INDEX IF NOT EXISTS "client_brains_currentTemperature_decisionStage_idx" ON "client_brains"("currentTemperature", "decisionStage");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_qualifications_leadId_fkey'
  ) THEN
    ALTER TABLE "lead_qualifications"
      ADD CONSTRAINT "lead_qualifications_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_brains_leadId_fkey'
  ) THEN
    ALTER TABLE "client_brains"
      ADD CONSTRAINT "client_brains_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
