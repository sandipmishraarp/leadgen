CREATE TABLE IF NOT EXISTS "draft_edits" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "beforeSubject" TEXT,
  "afterSubject" TEXT,
  "beforeBody" TEXT NOT NULL,
  "afterBody" TEXT NOT NULL,
  "editSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "draft_edits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_knowledge_items" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_knowledge_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "draft_edits_draftId_createdAt_idx" ON "draft_edits"("draftId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_knowledge_items_category_isActive_idx" ON "ai_knowledge_items"("category", "isActive");

ALTER TABLE "draft_edits"
  ADD CONSTRAINT "draft_edits_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
