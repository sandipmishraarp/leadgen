CREATE TABLE IF NOT EXISTS "tracking_sync_state" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "gatewayBaseUrl" TEXT,
  "lastTrackingEventId" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "lastHealthAt" TIMESTAMP(3),
  "lastHealthStatus" TEXT,
  "lastError" TEXT,
  "eventsPulled" INTEGER NOT NULL DEFAULT 0,
  "eventsImported" INTEGER NOT NULL DEFAULT 0,
  "eventsSkipped" INTEGER NOT NULL DEFAULT 0,
  "gatewayLatencyMs" INTEGER,
  "syncDurationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tracking_sync_state_pkey" PRIMARY KEY ("id")
);
