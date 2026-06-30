CREATE TABLE IF NOT EXISTS "approved_email_examples" (
  "id" TEXT NOT NULL,
  "emailType" TEXT NOT NULL,
  "leadIndustry" TEXT,
  "clientCountry" TEXT,
  "aiOriginalDraft" TEXT NOT NULL,
  "userFinalSentEmail" TEXT NOT NULL,
  "editDifference" TEXT,
  "wasSuccessful" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approved_email_examples_pkey" PRIMARY KEY ("id")
);
