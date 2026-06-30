import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { recordEmailOpen, recordLinkClick, setTrackingRuntimeDisabled, trackingBaseUrl, trackingEnabled, type TrackingMeta } from "@/lib/services/engagement";

const DEFAULT_INTERVAL_SECONDS = Number(process.env.SYNC_INTERVAL || 300);

type GatewayEvent = {
  id?: string | number;
  eventId?: string | number;
  trackingId?: string;
  tracking_id?: string;
  tid?: string;
  type?: string;
  eventType?: string;
  event_type?: string;
  url?: string;
  link?: string;
  original_url?: string;
  createdAt?: string;
  created_at?: string;
  ip?: string;
  ipAddress?: string;
  userAgent?: string;
  user_agent?: string;
  referrer?: string;
  browser?: string;
  device?: string;
};

export async function getTrackingState() {
  await ensureTrackingTables().catch(() => null);
  const delegate = trackingSyncStateDelegate();
  if (delegate) {
    try {
      return await delegate.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          enabled: trackingEnabled(),
          gatewayBaseUrl: trackingBaseUrl() || null,
          localDbStatus: "READY"
        },
        update: {
          enabled: trackingEnabled(),
          gatewayBaseUrl: trackingBaseUrl() || null,
          localDbStatus: "READY"
        }
      });
    } catch {
      // Fall back to raw SQL for stale Prisma clients or partially applied migrations.
    }
  }
  return rawTrackingState("READY").catch(() => fallbackTrackingState("Tracking local DB is not ready.", "UNKNOWN", null, "NOT_READY"));
}

export function trackingGatewayApiKeyConfigured() {
  return Boolean(process.env.TRACKING_GATEWAY_API_KEY?.trim());
}

export async function checkTrackingGatewayHealth() {
  const started = Date.now();
  if (!process.env.TRACKING_BASE_URL) {
    return updateHealth("DISABLED", "Tracking is disabled or TRACKING_BASE_URL is missing.", Date.now() - started);
  }
  try {
    const response = await fetch(`${trackingBaseUrl()}/health.php`, { cache: "no-store" });
    const latency = Date.now() - started;
    const body = await response.json().catch(() => ({}));
    const available = response.ok && body?.ok !== false;
    return updateHealth(available ? "AVAILABLE" : "UNAVAILABLE", available ? null : `Health check failed: ${response.status}`, latency);
  } catch (error) {
    return updateHealth("UNAVAILABLE", error instanceof Error ? error.message : String(error), Date.now() - started);
  }
}

export async function syncTrackingGateway() {
  const syncStarted = Date.now();
  const state = await getTrackingState();
  const localReady = await ensureTrackingTables().then(() => true).catch(() => false);
  if (!localReady) {
    return { imported: 0, skipped: 0, pulled: 0, disabled: true, error: "Tracking database is not ready." };
  }
  if (!trackingGatewayApiKeyConfigured()) {
    await updateTrackingStateRaw({ lastError: "TRACKING_GATEWAY_API_KEY is missing. Tracking sync skipped.", lastSyncAt: new Date(), localDbStatus: "READY" });
    return { imported: 0, skipped: 0, pulled: 0, disabled: true, error: "TRACKING_GATEWAY_API_KEY is missing." };
  }
  if (!process.env.TRACKING_GATEWAY_EVENTS_URL && !trackingBaseUrl()) {
    await updateTrackingStateRaw({ lastError: "Tracking gateway sync disabled or events URL missing.", lastSyncAt: new Date(), localDbStatus: "READY" });
    return { imported: 0, skipped: 0, pulled: 0, disabled: true };
  }

  const health = await checkTrackingGatewayHealth();
  if (health.lastHealthStatus !== "AVAILABLE") {
    return { imported: 0, skipped: 0, pulled: 0, disabled: true, error: health.lastError || `Gateway health status: ${health.lastHealthStatus}` };
  }

  const url = new URL(process.env.TRACKING_GATEWAY_EVENTS_URL || `${trackingBaseUrl()}/events.php`);
  if (state.lastTrackingEventId) url.searchParams.set("since_id", state.lastTrackingEventId);
  url.searchParams.set("limit", "500");

  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  let lastEventId = state.lastTrackingEventId || null;
  const gatewayStarted = Date.now();

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: gatewayHeaders()
    });
    const gatewayLatencyMs = Date.now() - gatewayStarted;
    if (!response.ok) throw new Error(`Gateway events request failed: ${response.status}`);
    const payload = await response.json().catch(() => []);
    const events = normalizeEvents(payload);

    for (const event of events) {
      const result = await importGatewayEvent(event);
      if (result.imported) imported += 1;
      else if ("unmatched" in result && result.unmatched) unmatched += 1;
      else skipped += 1;
      lastEventId = result.eventId || lastEventId;
    }

    await updateTrackingStateRaw({
      lastTrackingEventId: lastEventId,
      lastSyncAt: new Date(),
      lastError: null,
      localDbStatus: "READY",
      eventsPulledIncrement: events.length,
      eventsImportedIncrement: imported,
      eventsSkippedIncrement: skipped,
      unmatchedEventsIncrement: unmatched,
      gatewayLatencyMs,
      syncDurationMs: Date.now() - syncStarted
    });
    await markGatewayEventsSynced(lastEventId);
    return { imported, skipped, unmatched, pulled: events.length, lastEventId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTrackingStateRaw({
      lastSyncAt: new Date(),
      lastError: message,
      localDbStatus: "READY",
      syncDurationMs: Date.now() - syncStarted
    });
    await logActivity({ type: "ERROR", message: "Tracking gateway sync failed", metadata: { error: message } });
    return { imported, skipped, pulled: 0, error: message };
  }
}

async function importGatewayEvent(event: GatewayEvent) {
  const eventId = String(event.id ?? event.eventId ?? (event as any).event_id ?? "");
  const trackingId = event.trackingId || event.tracking_id || event.tid;
  const eventType = String(event.type || event.eventType || event.event_type || "").toLowerCase();
  if (!eventId || !trackingId) return { imported: false, eventId };
  const duplicate = !(await storeGatewayEvent(event, eventId, trackingId, eventType, false));
  if (duplicate) return { imported: false, eventId };

  const meta: TrackingMeta = {
    ipAddress: event.ipAddress || event.ip || null,
    userAgent: event.userAgent || event.user_agent || null,
    referrer: event.referrer || null
  };
  const metadata = {
    gatewayEventId: eventId,
    gatewayCreatedAt: event.createdAt || event.created_at || null,
    latestDevice: event.device || null,
    latestBrowser: event.browser || null
  };

  if (eventType.includes("open")) {
    const updated = await recordEmailOpen(trackingId, meta);
    if (!updated) return markGatewayEventUnmatched(eventId, trackingId, eventType);
    await markGatewayEventMatched(eventId);
    await annotateLatestActivity(trackingId, "Email Opened", metadata);
    return { imported: true, eventId };
  }
  if (eventType.includes("click")) {
    const updated = await recordLinkClick(trackingId, event.original_url || event.url || event.link || "", meta);
    if (!updated.engagement) return markGatewayEventUnmatched(eventId, trackingId, eventType);
    await markGatewayEventMatched(eventId);
    await annotateLatestActivity(trackingId, "Email Clicked", metadata);
    return { imported: true, eventId };
  }
  return markGatewayEventUnmatched(eventId, trackingId, eventType);
}

async function annotateLatestActivity(engagementId: string, title: string, metadata: Record<string, unknown>) {
  const engagement = await prisma.emailEngagement.findUnique({
    where: { id: engagementId },
    include: { sentEmail: { include: { thread: true } } }
  });
  if (!engagement) return;
  await logActivity({
    type: "EMAIL_SENT",
    message: title,
    leadId: engagement.sentEmail.thread.leadId || undefined,
    threadId: engagement.sentEmail.threadId,
    metadata: { engagementId, ...metadata }
  });
}

async function updateHealth(status: string, error: string | null, latencyMs: number) {
  setTrackingRuntimeDisabled(status === "UNAVAILABLE" || status === "DISABLED");
  await ensureTrackingTables().catch(() => null);
  const delegate = trackingSyncStateDelegate();
  if (delegate) {
    try {
      return await delegate.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          enabled: trackingEnabled(),
          gatewayBaseUrl: trackingBaseUrl() || null,
          lastHealthAt: new Date(),
          lastHealthStatus: status,
          lastError: error,
          gatewayLatencyMs: latencyMs,
          localDbStatus: "READY"
        },
        update: {
          enabled: trackingEnabled(),
          gatewayBaseUrl: trackingBaseUrl() || null,
          lastHealthAt: new Date(),
          lastHealthStatus: status,
          lastError: error,
          gatewayLatencyMs: latencyMs,
          localDbStatus: "READY"
        }
      });
    } catch {
      // Fall back to raw SQL below.
    }
  }
  await updateTrackingStateRaw({ lastHealthAt: new Date(), lastHealthStatus: status, lastError: error, gatewayLatencyMs: latencyMs, localDbStatus: "READY" }).catch(() => null);
  return rawTrackingState("READY").catch(() => fallbackTrackingState(error, status, latencyMs, "NOT_READY"));
}

async function markGatewayEventsSynced(lastEventId: string | null) {
  if (!lastEventId || !process.env.TRACKING_GATEWAY_MARK_SYNCED_URL) return;
  try {
    await fetch(process.env.TRACKING_GATEWAY_MARK_SYNCED_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...gatewayHeaders()
      },
      body: JSON.stringify({ lastEventId })
    });
  } catch {
    // Marking remote sync is optional; local lastTrackingEventId prevents duplicates.
  }
}

function gatewayHeaders() {
  return { "X-API-Key": process.env.TRACKING_GATEWAY_API_KEY?.trim() || "" };
}

function trackingSyncStateDelegate() {
  return (prisma as any).trackingSyncState || null;
}

async function ensureTrackingTables() {
  await prisma.$executeRawUnsafe(`
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
      "unmatchedEvents" INTEGER NOT NULL DEFAULT 0,
      "localDbStatus" TEXT,
      "gatewayLatencyMs" INTEGER,
      "syncDurationMs" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "tracking_sync_state_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "tracking_sync_state" ADD COLUMN IF NOT EXISTS "unmatchedEvents" INTEGER NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "tracking_sync_state" ADD COLUMN IF NOT EXISTS "localDbStatus" TEXT`);
  await prisma.$executeRawUnsafe(`
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
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "tracking_gateway_events_gatewayId_key" ON "tracking_gateway_events"("gatewayId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "tracking_gateway_events_trackingId_eventType_idx" ON "tracking_gateway_events"("trackingId", "eventType")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "tracking_gateway_events_matched_importedAt_idx" ON "tracking_gateway_events"("matched", "importedAt")`);
}

async function rawTrackingState(localDbStatus = "READY") {
  await prisma.$executeRaw`
    INSERT INTO "tracking_sync_state" ("id", "enabled", "gatewayBaseUrl", "localDbStatus", "updatedAt")
    VALUES ('default', ${trackingEnabled()}, ${trackingBaseUrl() || null}, ${localDbStatus}, NOW())
    ON CONFLICT ("id") DO UPDATE SET
      "enabled" = EXCLUDED."enabled",
      "gatewayBaseUrl" = EXCLUDED."gatewayBaseUrl",
      "localDbStatus" = EXCLUDED."localDbStatus",
      "updatedAt" = NOW()
  `;
  const rows = await prisma.$queryRaw<Array<any>>`SELECT * FROM "tracking_sync_state" WHERE "id" = 'default' LIMIT 1`;
  return rows[0] || fallbackTrackingState(null, "UNKNOWN", null, localDbStatus);
}

async function updateTrackingStateRaw(input: {
  lastTrackingEventId?: string | null;
  lastSyncAt?: Date;
  lastHealthAt?: Date;
  lastHealthStatus?: string | null;
  lastError?: string | null;
  localDbStatus?: string | null;
  eventsPulledIncrement?: number;
  eventsImportedIncrement?: number;
  eventsSkippedIncrement?: number;
  unmatchedEventsIncrement?: number;
  gatewayLatencyMs?: number | null;
  syncDurationMs?: number | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "tracking_sync_state" (
      "id",
      "enabled",
      "gatewayBaseUrl",
      "lastTrackingEventId",
      "lastSyncAt",
      "lastHealthAt",
      "lastHealthStatus",
      "lastError",
      "localDbStatus",
      "eventsPulled",
      "eventsImported",
      "eventsSkipped",
      "unmatchedEvents",
      "gatewayLatencyMs",
      "syncDurationMs",
      "updatedAt"
    )
    VALUES (
      'default',
      ${trackingEnabled()},
      ${trackingBaseUrl() || null},
      ${input.lastTrackingEventId ?? null},
      ${input.lastSyncAt ?? null},
      ${input.lastHealthAt ?? null},
      ${input.lastHealthStatus ?? null},
      ${input.lastError ?? null},
      ${input.localDbStatus ?? "READY"},
      ${input.eventsPulledIncrement || 0},
      ${input.eventsImportedIncrement || 0},
      ${input.eventsSkippedIncrement || 0},
      ${input.unmatchedEventsIncrement || 0},
      ${input.gatewayLatencyMs ?? null},
      ${input.syncDurationMs ?? null},
      NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "enabled" = EXCLUDED."enabled",
      "gatewayBaseUrl" = EXCLUDED."gatewayBaseUrl",
      "lastTrackingEventId" = COALESCE(EXCLUDED."lastTrackingEventId", "tracking_sync_state"."lastTrackingEventId"),
      "lastSyncAt" = COALESCE(EXCLUDED."lastSyncAt", "tracking_sync_state"."lastSyncAt"),
      "lastHealthAt" = COALESCE(EXCLUDED."lastHealthAt", "tracking_sync_state"."lastHealthAt"),
      "lastHealthStatus" = COALESCE(EXCLUDED."lastHealthStatus", "tracking_sync_state"."lastHealthStatus"),
      "lastError" = EXCLUDED."lastError",
      "localDbStatus" = COALESCE(EXCLUDED."localDbStatus", "tracking_sync_state"."localDbStatus"),
      "eventsPulled" = "tracking_sync_state"."eventsPulled" + EXCLUDED."eventsPulled",
      "eventsImported" = "tracking_sync_state"."eventsImported" + EXCLUDED."eventsImported",
      "eventsSkipped" = "tracking_sync_state"."eventsSkipped" + EXCLUDED."eventsSkipped",
      "unmatchedEvents" = "tracking_sync_state"."unmatchedEvents" + EXCLUDED."unmatchedEvents",
      "gatewayLatencyMs" = COALESCE(EXCLUDED."gatewayLatencyMs", "tracking_sync_state"."gatewayLatencyMs"),
      "syncDurationMs" = COALESCE(EXCLUDED."syncDurationMs", "tracking_sync_state"."syncDurationMs"),
      "updatedAt" = NOW()
  `;
}

async function storeGatewayEvent(event: GatewayEvent, eventId: string, trackingId: string, eventType: string, matched: boolean) {
  const originalUrl = event.original_url || event.url || event.link || null;
  const occurredAt = parseGatewayDate(event.createdAt || event.created_at);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "tracking_gateway_events" (
      "id",
      "gatewayId",
      "trackingId",
      "eventType",
      "originalUrl",
      "ipAddress",
      "userAgent",
      "rawEvent",
      "matched",
      "occurredAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${eventId},
      ${trackingId},
      ${eventType || null},
      ${originalUrl},
      ${event.ipAddress || event.ip || null},
      ${event.userAgent || event.user_agent || null},
      ${JSON.stringify(event)}::jsonb,
      ${matched},
      ${occurredAt}
    )
    ON CONFLICT ("gatewayId") DO NOTHING
    RETURNING "id"
  `);
  return rows.length > 0;
}

async function markGatewayEventMatched(eventId: string) {
  await prisma.$executeRaw`UPDATE "tracking_gateway_events" SET "matched" = true WHERE "gatewayId" = ${eventId}`;
}

async function markGatewayEventUnmatched(eventId: string, trackingId: string, eventType: string) {
  await prisma.$executeRaw`UPDATE "tracking_gateway_events" SET "matched" = false WHERE "gatewayId" = ${eventId}`;
  return { imported: false, unmatched: true, eventId, trackingId, eventType };
}

function parseGatewayDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fallbackTrackingState(error: string | null, status = "UNKNOWN", latencyMs: number | null = null, localDbStatus = "NOT_READY") {
  return {
    id: "default",
    enabled: trackingEnabled(),
    gatewayBaseUrl: trackingBaseUrl() || null,
    lastTrackingEventId: null,
    lastSyncAt: null,
    lastHealthAt: null,
    lastHealthStatus: status,
    lastError: error,
    eventsPulled: 0,
    eventsImported: 0,
    eventsSkipped: 0,
    unmatchedEvents: 0,
    localDbStatus,
    gatewayLatencyMs: latencyMs,
    syncDurationMs: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function normalizeEvents(payload: unknown): GatewayEvent[] {
  if (Array.isArray(payload)) return payload as GatewayEvent[];
  if (payload && typeof payload === "object") {
    const record = payload as { events?: unknown; data?: unknown };
    if (Array.isArray(record.events)) return record.events as GatewayEvent[];
    if (Array.isArray(record.data)) return record.data as GatewayEvent[];
  }
  return [];
}

declare global {
  // eslint-disable-next-line no-var
  var trackingSyncInterval: NodeJS.Timeout | undefined;
}

export function ensureTrackingSyncScheduler() {
  if (typeof window !== "undefined") return;
  if (globalThis.trackingSyncInterval) return;
  syncTrackingGateway().catch(() => undefined);
  globalThis.trackingSyncInterval = setInterval(() => {
    syncTrackingGateway().catch(() => undefined);
  }, DEFAULT_INTERVAL_SECONDS * 1000);
}
