CREATE TABLE IF NOT EXISTS "ai_usage_settings" (
  "id" TEXT NOT NULL,
  "dailyTokenLimit" INTEGER NOT NULL DEFAULT 50000,
  "dailyCostLimit" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "perUserDailyTokenLimit" INTEGER,
  "perFeatureDailyTokenLimit" JSONB,
  "perFeatureDailyCostLimit" JSONB,
  "smallModel" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
  "mainModel" TEXT NOT NULL DEFAULT 'gpt-5.5',
  "bulkDraftsPerHour" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_usage_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
  "id" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencyMs" INTEGER,
  "leadId" TEXT,
  "userId" TEXT,
  "cacheKey" TEXT,
  "cacheHit" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_response_cache" (
  "id" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "leadId" TEXT,
  "action" TEXT,
  "model" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_response_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_response_cache_cacheKey_key" ON "ai_response_cache"("cacheKey");
CREATE INDEX IF NOT EXISTS "ai_usage_logs_feature_createdAt_idx" ON "ai_usage_logs"("feature", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_logs_leadId_createdAt_idx" ON "ai_usage_logs"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_logs_userId_createdAt_idx" ON "ai_usage_logs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_response_cache_feature_leadId_createdAt_idx" ON "ai_response_cache"("feature", "leadId", "createdAt");
