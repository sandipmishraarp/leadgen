DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension is not installed on this PostgreSQL server; using JSONB embeddings only.';
END $$;

CREATE TABLE IF NOT EXISTS "vector_chunks" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "embedding" JSONB NOT NULL,
  "metadata" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vector_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vector_chunks_sourceType_sourceId_contentHash_key"
  ON "vector_chunks"("sourceType", "sourceId", "contentHash");

CREATE INDEX IF NOT EXISTS "vector_chunks_sourceType_isActive_idx"
  ON "vector_chunks"("sourceType", "isActive");

CREATE INDEX IF NOT EXISTS "vector_chunks_category_isActive_idx"
  ON "vector_chunks"("category", "isActive");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE "vector_chunks" ADD COLUMN IF NOT EXISTS "embeddingVector" vector(1536)';

    EXECUTE 'CREATE INDEX IF NOT EXISTS "vector_chunks_embeddingVector_idx"
      ON "vector_chunks"
      USING ivfflat ("embeddingVector" vector_cosine_ops)
      WITH (lists = 100)';
  END IF;
END $$;
