import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { syncAllActiveAccountsNow } from "@/lib/services/sync-engine";
import { syncLeadIntakeEmails } from "@/lib/services/imap";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  mode: z.enum(["all", "lead-intake-latest", "force-lead-intake-latest"]).optional(),
  accountId: z.string().optional(),
  accountEmail: z.string().optional()
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const body = await request.json().catch(() => ({}));
    const input = schema.parse(body);
    const accountKey = input.accountId || input.accountEmail || "all";
    if (isSyncRunning(accountKey)) {
      return jsonOk({ queued: true, status: "RUNNING", message: "Sync already running." });
    }
    markSyncRunning(accountKey);
    if (input.mode === "lead-intake-latest" || input.mode === "force-lead-intake-latest") {
      const forceLatest = input.mode === "force-lead-intake-latest";
      runBackgroundSync(accountKey, async () => syncLeadIntakeEmails(forceLatest ? 100 : Math.min(input.limit || 50, 50), input.accountId || input.accountEmail, { forceLatest }));
      return jsonOk({ queued: true, status: "RUNNING", message: forceLatest ? "Force resync latest 100 started in background." : "Latest lead sync started in background." });
    }
    runBackgroundSync(accountKey, async () => syncAllActiveAccountsNow({ trigger: "manual", batchSize: input.limit }));
    return jsonOk({ queued: true, status: "RUNNING", message: "Email sync started in background." });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const accountEmail = searchParams.get("accountEmail");
    const account = accountId || accountEmail
      ? await prisma.emailAccount.findFirst({
          where: {
            OR: [
              accountId ? { id: accountId } : undefined,
              accountEmail ? { emailAddress: { equals: accountEmail, mode: "insensitive" } } : undefined
            ].filter(Boolean) as any
          },
          select: { emailAddress: true, lastSyncedAt: true, connectionStatus: true }
        })
      : null;
    const key = accountId || accountEmail || "all";
    const status = getSyncStatus(key);
    return jsonOk({
      status: status?.status || (isSyncRunning(key) ? "RUNNING" : "IDLE"),
      message: status?.message || null,
      result: status?.result || null,
      error: status?.error || null,
      updatedAt: status?.updatedAt || null,
      lastSyncedAt: account?.lastSyncedAt || null,
      account: account?.emailAddress || accountEmail || null,
      connectionStatus: account?.connectionStatus || null
    });
  } catch (error) {
    return jsonError(error);
  }
}

type BackgroundSyncStatus = {
  status: "RUNNING" | "COMPLETED" | "FAILED";
  message?: string;
  result?: unknown;
  error?: string;
  updatedAt: string;
};

const syncState = globalThis as typeof globalThis & {
  __aiSalesSyncJobs?: Map<string, BackgroundSyncStatus>;
};

function syncJobs() {
  if (!syncState.__aiSalesSyncJobs) syncState.__aiSalesSyncJobs = new Map();
  return syncState.__aiSalesSyncJobs;
}

function isSyncRunning(key: string) {
  return syncJobs().get(key)?.status === "RUNNING";
}

function markSyncRunning(key: string) {
  syncJobs().set(key, { status: "RUNNING", message: "Sync running in background.", updatedAt: new Date().toISOString() });
}

function getSyncStatus(key: string) {
  return syncJobs().get(key);
}

function runBackgroundSync(key: string, task: () => Promise<unknown>) {
  setTimeout(async () => {
    try {
      const result = await task();
      syncJobs().set(key, {
        status: "COMPLETED",
        message: "Sync completed.",
        result,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      syncJobs().set(key, {
        status: "FAILED",
        message: "Sync failed.",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString()
      });
    }
  }, 0);
}
