ALTER TABLE "tracking_sync_state"
  ADD COLUMN IF NOT EXISTS "unmatchedEvents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "localDbStatus" TEXT;

CREATE TABLE IF NOT EXISTS "tracking_gateway_events" (
  "id" TEXT NOT NULL,
  "gatewayId" TEXT NOT NULL,
  "trackingId" TEXT,
  "eventType" TEXT,
  "originalUrl" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "rawEvent" JSONB NOT NULL,
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurredAt" TIMESTAMP(3),
  CONSTRAINT "tracking_gateway_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tracking_gateway_events_gatewayId_key" ON "tracking_gateway_events"("gatewayId");
CREATE INDEX IF NOT EXISTS "tracking_gateway_events_trackingId_eventType_idx" ON "tracking_gateway_events"("trackingId", "eventType");
CREATE INDEX IF NOT EXISTS "tracking_gateway_events_matched_importedAt_idx" ON "tracking_gateway_events"("matched", "importedAt");
