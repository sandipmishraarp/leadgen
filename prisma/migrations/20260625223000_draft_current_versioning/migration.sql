ALTER TABLE "drafts"
  ADD COLUMN IF NOT EXISTS "draftVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "basedOnMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "basedOnEmailDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "drafts_threadId_isCurrent_createdAt_idx"
  ON "drafts"("threadId", "isCurrent", "createdAt");
