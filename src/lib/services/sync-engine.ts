import type { EmailAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLeadImportJob, runLeadImportJobBatch } from "@/lib/services/lead-import";
import { syncEmailAccount } from "@/lib/services/imap";
import { getAutomationSettings } from "@/lib/services/safe-automation";
import { processDueScheduledEmails } from "@/lib/services/scheduled-email";

const INTERVALS: Record<string, number> = {
  MANUAL: 0,
  "EVERY_2_MIN": 2 * 60 * 1000,
  "EVERY_5_MIN": 5 * 60 * 1000,
  "EVERY_15_MIN": 15 * 60 * 1000,
  "EVERY_30_MIN": 30 * 60 * 1000,
  "EVERY_1_HOUR": 60 * 60 * 1000
};

export function defaultSyncInterval(account: Pick<EmailAccount, "accountType" | "role">) {
  return account.accountType === "LEAD_INTAKE" || /lead intake/i.test(account.role)
    ? "EVERY_2_MIN"
    : "EVERY_5_MIN";
}

export function parseSchedulerConfig(account: Pick<EmailAccount, "schedulerConfig" | "accountType" | "role" | "autoSyncEnabled">) {
  const config = account.schedulerConfig && typeof account.schedulerConfig === "object" && !Array.isArray(account.schedulerConfig)
    ? account.schedulerConfig as Record<string, unknown>
    : {};
  const interval = String(config.syncInterval || config.interval || defaultSyncInterval(account));
  const batchSize = normalizeOption(Number(config.batchSize || 100), [50, 100, 250, 500], 100);
  const concurrency = normalizeOption(Number(config.concurrency || 2), [1, 2, 3, 5], 2);
  const autoSyncEnabled = typeof config.autoSyncEnabled === "boolean" ? config.autoSyncEnabled : account.autoSyncEnabled || interval !== "MANUAL";
  return {
    interval: INTERVALS[interval] === undefined ? defaultSyncInterval(account) : interval,
    intervalMs: INTERVALS[INTERVALS[interval] === undefined ? defaultSyncInterval(account) : interval],
    batchSize,
    concurrency,
    autoSyncEnabled
  };
}

export async function syncAccountNow(accountId: string, options: { trigger?: "manual" | "auto"; batchSize?: number; concurrency?: number } = {}) {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Email account not found");
  if (!account.isActive) throw new Error("Email account is disabled");

  const scheduler = parseSchedulerConfig(account);
  const batchSize = options.batchSize || scheduler.batchSize;
  const concurrency = options.concurrency || scheduler.concurrency;
  const startedAt = new Date();
  const syncJob = getSyncJobDelegate();
  const job = syncJob?.create
    ? await syncJob.create({
        data: {
          accountId: account.id,
          accountEmail: account.emailAddress,
          jobType: options.trigger === "auto" ? "AUTO_SYNC" : "MANUAL_SYNC",
          status: "RUNNING",
          batchSize,
          concurrency,
          startedAt
        }
      })
    : null;

  try {
    const result = account.accountType === "LEAD_INTAKE"
      ? await syncLeadAccountFolders(account, { batchSize, concurrency, syncJobId: job?.id })
      : await syncEmailAccount(account.id, { batchSize });

    const importedCount = sumImported(result);
    const skippedCount = sumSkipped(result);
    const errorCount = sumErrors(result);
    const elapsedMinutes = Math.max((Date.now() - startedAt.getTime()) / 60000, 1 / 60);
    const completed = job?.id && syncJob?.update
      ? await syncJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            importedCount,
            skippedCount,
            errorCount,
            remainingCount: sumRemaining(result),
            speedPerMinute: Math.round((importedCount / elapsedMinutes) * 10) / 10,
            completedAt: new Date()
          }
        })
      : createInMemorySyncJob(account, options.trigger, batchSize, concurrency, startedAt, {
          status: "COMPLETED",
          importedCount,
          skippedCount,
          errorCount,
          remainingCount: sumRemaining(result),
          speedPerMinute: Math.round((importedCount / elapsedMinutes) * 10) / 10,
          completedAt: new Date()
        });
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        status: "CONNECTED",
        connectionStatus: {
          lastSyncStatus: "COMPLETED",
          syncJobId: job?.id || null,
          syncJobWarning: job ? undefined : missingSyncJobMessage(),
          syncedAt: new Date().toISOString()
        }
      }
    });
    return { job: completed, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job?.id && syncJob?.update) {
      await syncJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: message, completedAt: new Date(), errorCount: { increment: 1 } }
      }).catch(() => null);
    }
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        status: "ERROR",
        connectionStatus: {
          lastSyncStatus: "FAILED",
          syncJobId: job?.id || null,
          syncJobWarning: job ? undefined : missingSyncJobMessage(),
          error: message,
          syncedAt: new Date().toISOString()
        }
      }
    }).catch(() => null);
    throw error;
  }
}

export async function syncAllActiveAccountsNow(options: { trigger?: "manual" | "auto"; batchSize?: number } = {}) {
  const accounts = await prisma.emailAccount.findMany({ where: { isActive: true }, orderBy: { emailAddress: "asc" } });
  const results = [];
  const syncJob = getSyncJobDelegate();
  for (const account of accounts) {
    const running = syncJob?.findFirst
      ? await syncJob.findFirst({
          where: { accountId: account.id, status: "RUNNING" },
          select: { id: true }
        })
      : null;
    if (running) {
      results.push({ account: account.emailAddress, skipped: true, reason: "Sync already running" });
      continue;
    }
    results.push({
      account: account.emailAddress,
      result: await syncAccountNow(account.id, { trigger: options.trigger || "manual", batchSize: options.batchSize }).catch((error) => ({
        error: error instanceof Error ? error.message : String(error)
      }))
    });
  }
  return { accounts: results };
}

export async function runDueAutoSyncOnce() {
  await processDueScheduledEmails();
  const automationSettings = await getAutomationSettings();
  if (!automationSettings.autoSyncEnabled) return { processed: 0, results: [], skipped: "Auto-sync disabled" };
  const accounts = await prisma.emailAccount.findMany({ where: { isActive: true }, orderBy: { lastSyncedAt: "asc" } });
  const results = [];
  const now = Date.now();
  const syncJob = getSyncJobDelegate();

  for (const account of accounts) {
    const scheduler = parseSchedulerConfig(account);
    if (!scheduler.autoSyncEnabled || scheduler.intervalMs <= 0) continue;
    const dueAt = (account.lastSyncedAt?.getTime() || 0) + scheduler.intervalMs;
    if (dueAt > now) continue;
    const running = syncJob?.findFirst
      ? await syncJob.findFirst({ where: { accountId: account.id, status: "RUNNING" }, select: { id: true } })
      : null;
    if (running) continue;
    results.push(await syncAccountNow(account.id, { trigger: "auto", batchSize: scheduler.batchSize, concurrency: scheduler.concurrency }).catch((error) => ({
      account: account.emailAddress,
      error: error instanceof Error ? error.message : String(error)
    })));
  }

  return { processed: results.length, results };
}

export function nextAutoSyncAt(account: Pick<EmailAccount, "schedulerConfig" | "accountType" | "role" | "autoSyncEnabled" | "lastSyncedAt">) {
  const scheduler = parseSchedulerConfig(account);
  if (!scheduler.autoSyncEnabled || scheduler.intervalMs <= 0) return null;
  return new Date((account.lastSyncedAt?.getTime() || Date.now()) + scheduler.intervalMs);
}

async function syncLeadAccountFolders(account: EmailAccount, options: { batchSize: number; concurrency: number; syncJobId?: string }) {
  const folderConfig = parseFolderConfig(account.folderConfig);
  const selectedFolders = folderConfig.selectedFolders.length ? folderConfig.selectedFolders : [account.inboxFolder || "INBOX"];
  const job = await createLeadImportJob({ accountId: account.id, folderPaths: selectedFolders, batchSize: options.batchSize });
  let latest = await runLeadImportJobBatch(job.id);

  for (let i = 1; i < Math.max(options.concurrency, 1); i += 1) {
    if (!latest || latest.status === "COMPLETED" || latest.status === "FAILED" || latest.status === "PAUSED") break;
    latest = await runLeadImportJobBatch(job.id);
  }

  const syncJob = getSyncJobDelegate();
  if (options.syncJobId && syncJob?.update) {
    await syncJob.update({
      where: { id: options.syncJobId },
      data: { currentFolderPath: latest?.currentFolderPath || null }
    }).catch(() => null);
  }

  return {
    leadImportJobId: job.id,
    imported: latest?.importedCount || 0,
    skipped: latest?.skippedCount || 0,
    errors: latest?.errorCount || 0,
    remaining: latest?.status === "COMPLETED" ? 0 : latest?.folders.filter((folder) => folder.status !== "COMPLETED").length || 0,
    status: latest?.status
  };
}

function parseFolderConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { selectedFolders: [] as string[] };
  const selectedFolders = (value as { selectedFolders?: unknown }).selectedFolders;
  return {
    selectedFolders: Array.isArray(selectedFolders) ? selectedFolders.map(String).filter(Boolean) : []
  };
}

function normalizeOption(value: number, allowed: number[], fallback: number) {
  return allowed.includes(value) ? value : fallback;
}

function getSyncJobDelegate() {
  const delegate = (prisma as any).syncJob;
  return delegate && typeof delegate === "object" ? delegate : null;
}

function missingSyncJobMessage() {
  return "Sync failed because model/table is missing or not migrated. Please run Prisma migration/generate.";
}

function createInMemorySyncJob(
  account: EmailAccount,
  trigger: "manual" | "auto" | undefined,
  batchSize: number,
  concurrency: number,
  startedAt: Date,
  data: Record<string, unknown>
) {
  const now = new Date();
  return {
    id: null,
    accountId: account.id,
    accountEmail: account.emailAddress,
    jobType: trigger === "auto" ? "AUTO_SYNC" : "MANUAL_SYNC",
    batchSize,
    concurrency,
    startedAt,
    createdAt: startedAt,
    updatedAt: now,
    ...data,
    syncJobWarning: missingSyncJobMessage()
  };
}

function sumImported(result: any): number {
  if (!result) return 0;
  if (typeof result.imported === "number") return result.imported;
  return Number(result.inbox?.imported || 0) + Number(result.sent?.imported || 0);
}

function sumSkipped(result: any): number {
  if (!result) return 0;
  if (typeof result.skipped === "number") return result.skipped;
  return Number(result.inbox?.skipped || 0) + Number(result.sent?.skipped || 0);
}

function sumErrors(result: any): number {
  if (!result) return 0;
  if (typeof result.errors === "number") return result.errors;
  return Number(result.inbox?.errors || 0) + Number(result.sent?.errors || 0);
}

function sumRemaining(result: any): number {
  if (!result) return 0;
  if (typeof result.remaining === "number") return result.remaining;
  return Number(result.inbox?.remaining || 0) + Number(result.sent?.remaining || 0);
}
