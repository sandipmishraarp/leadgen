import { prisma } from "@/lib/prisma";

const INTERVALS: Record<string, number> = {
  MANUAL: 0,
  EVERY_5_MIN: 5 * 60 * 1000,
  EVERY_15_MIN: 15 * 60 * 1000,
  EVERY_30_MIN: 30 * 60 * 1000,
  EVERY_1_HOUR: 60 * 60 * 1000
};

export async function getSyncCenterSnapshot() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const [accounts, syncJobs, folderStates, leadImportJobs, recentActivity, summaryCounts] = await Promise.all([
    safeFindMany<any>("emailAccount", {
      where: { isActive: true },
      orderBy: { emailAddress: "asc" },
      include: {
        _count: { select: { emails: true, leadIntakes: true } },
        emails: { orderBy: { importedAt: "desc" }, take: 1 },
        leadIntakes: { orderBy: { importedAt: "desc" }, take: 1 }
      }
    }),
    safeFindMany<any>("syncJob", {
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { account: true }
    }),
    safeFindMany<any>("emailFolderSyncState", {
      orderBy: [{ updatedAt: "desc" }],
      take: 200
    }),
    safeFindMany<any>("leadImportJob", {
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { folders: { orderBy: { updatedAt: "desc" } } }
    }),
    safeFindMany<any>("activityLog", {
      where: { type: "MAIL_SYNC" },
      orderBy: { createdAt: "desc" },
      take: 40
    }),
    Promise.all([
      safeCount("email", { where: { importedAt: { gte: today } } }),
      safeCount("lead", { where: { createdAt: { gte: today } } }),
      safeCount("lead", { where: { updatedAt: { gte: today }, createdAt: { lt: today } } }),
      safeCount("leadIntake", { where: { importedAt: { gte: today }, parsingStatus: "FAILED" } }),
      safeCount("syncJob", { where: { status: "FAILED", updatedAt: { gte: today } } })
    ])
  ]);

  const [emailsImportedToday, leadsCreatedToday, leadsUpdatedToday, parseFailuresToday, failedJobsToday] = summaryCounts;
  const jobs = syncJobs.length ? syncJobs : leadImportJobs.map(leadImportJobToReportJob);
  const folderByAccount = groupBy(folderStates, (folder) => folder.accountId);
  const latestLeadImportByAccount = new Map(leadImportJobs.map((job) => [job.accountId, job]));
  const runningJobs = jobs.filter((job) => job.status === "RUNNING");
  const completedJobs = jobs.filter((job) => job.status === "COMPLETED");
  const averageSpeed = average(completedJobs.map((job) => job.speedPerMinute || 0).filter(Boolean));
  const duplicateEmails = jobs
    .filter((job) => job.createdAt >= today)
    .reduce((sum, job) => sum + job.skippedCount, 0);

  const accountCards = accounts.map((account) => {
    const scheduler = parseSchedulerConfigForReport(account);
    const folders = folderByAccount.get(account.id) || [];
    const latestLeadImport = latestLeadImportByAccount.get(account.id);
    const running = runningJobs.find((job) => job.accountId === account.id);
    const failedFolders = folders.filter((folder) => folder.status === "FAILED" || folder.lastError);
    return {
      id: account.id,
      mailbox: account.emailAddress,
      role: account.role,
      autoSyncEnabled: scheduler.autoSyncEnabled,
      lastEmailSync: account.lastSyncedAt || null,
      lastLeadParse: latestLeadImport?.updatedAt || account.leadIntakes?.[0]?.updatedAt || null,
      lastLeadCreated: account.leadIntakes?.[0]?.importedAt || null,
      nextAutoSync: nextAutoSyncAtForReport(account),
      foldersMonitored: folders.length,
      totalEmailsImported: Number(account._count?.emails || 0) + Number(account._count?.leadIntakes || 0),
      totalLeads: Number(account._count?.leadIntakes || 0),
      currentStatus: running ? "Running" : failedFolders.length ? "Failed" : scheduler.autoSyncEnabled ? "Idle" : "Paused",
      failedFolders: failedFolders.map((folder) => ({ folderPath: folder.folderPath, error: folder.lastError }))
    };
  });

  const jobRows = jobs.map((job) => {
    const relatedLeadImport = leadImportJobs.find((item) => item.accountId === job.accountId && withinJobWindow(item.createdAt, job.startedAt || job.createdAt, job.completedAt || job.updatedAt));
    const folder = job.currentFolderPath || relatedLeadImport?.currentFolderPath || relatedLeadImport?.folders[0]?.folderPath || "";
    const jobWindowStart = job.startedAt || job.createdAt;
    const jobWindowEnd = job.completedAt || job.updatedAt || now;
    const leadStats = deriveLeadStats(relatedLeadImport, jobWindowStart, jobWindowEnd);
    return {
      id: job.id,
      accountId: job.accountId,
      accountEmail: job.accountEmail || job.account?.emailAddress || "All accounts",
      status: job.status,
      jobType: jobTypeLabel(job.jobType, relatedLeadImport, folder),
      triggerType: job.jobType === "AUTO_SYNC" ? "Auto Sync" : "Manual Sync",
      folder: folder || "Multiple folders",
      emailsNew: job.importedCount,
      duplicateEmails: job.skippedCount,
      emailErrors: job.errorCount,
      leadsCreated: leadStats.created,
      leadsUpdated: leadStats.updated,
      leadsMerged: leadStats.merged,
      parseFailed: leadStats.parseFailed,
      processedEmails: job.importedCount + job.skippedCount + job.errorCount,
      remainingEmails: job.remainingCount,
      speedPerMinute: job.speedPerMinute || estimateSpeed(job.importedCount + job.skippedCount + job.errorCount, job.startedAt, job.completedAt || now),
      estimatedRemainingSeconds: estimateRemainingSeconds(job.remainingCount, job.speedPerMinute),
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
      lastError: job.lastError
    };
  });

  const liveJob = jobRows.find((job) => job.status === "RUNNING") || null;
  const lastSync = jobs[0]?.updatedAt || null;
  const nextAutoSync = accountCards
    .map((account) => account.nextAutoSync ? new Date(account.nextAutoSync) : null)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;

  return {
    generatedAt: now,
    summary: {
      emailsImportedToday,
      duplicateEmails,
      leadsCreatedToday,
      leadsUpdatedToday,
      parseFailuresToday,
      failedJobsToday,
      runningJobs: runningJobs.length,
      averageImportSpeed: Math.round(averageSpeed * 10) / 10
    },
    liveMonitor: liveJob
      ? {
          ...liveJob,
          progressPercent: progressPercent(liveJob.processedEmails, liveJob.remainingEmails)
        }
      : {
          status: "IDLE",
          message: "No sync currently running.",
          lastSync,
          nextAutoSync
        },
    accounts: accountCards,
    jobs: jobRows,
    folderStates: folderStates.map((folder) => ({
      id: folder.id,
      accountEmail: folder.accountEmail,
      folderPath: folder.folderPath,
      folderRole: folder.folderRole,
      status: folder.status,
      lastUid: folder.lastUid,
      highestUid: folder.highestUid,
      uidValidity: folder.uidValidity,
      importedCount: folder.importedCount,
      skippedCount: folder.skippedCount,
      errorCount: folder.errorCount,
      lastError: folder.lastError,
      lastSyncedAt: folder.lastSyncedAt,
      updatedAt: folder.updatedAt
    })),
    activity: buildActivity(jobRows, leadImportJobs, recentActivity),
    failedJobs: jobRows.filter((job) => job.status === "FAILED" || job.lastError)
  };
}

function getDelegate(modelName: string) {
  return (prisma as any)?.[modelName];
}

async function safeFindMany<T>(modelName: string, args: Record<string, unknown>): Promise<T[]> {
  const model = getDelegate(modelName);
  if (!model?.findMany) return [];
  try {
    return await model.findMany(args);
  } catch (error) {
    console.warn(`Sync Center reporting skipped ${modelName}.findMany`, error);
    return [];
  }
}

async function safeCount(modelName: string, args: Record<string, unknown>): Promise<number> {
  const model = getDelegate(modelName);
  if (!model?.count) return 0;
  try {
    return await model.count(args);
  } catch (error) {
    console.warn(`Sync Center reporting skipped ${modelName}.count`, error);
    return 0;
  }
}

function leadImportJobToReportJob(job: any) {
  return {
    id: job.id,
    accountId: job.accountId,
    accountEmail: job.accountEmail,
    account: null,
    jobType: "LEAD_IMPORT",
    status: job.status,
    currentFolderPath: job.currentFolderPath || job.folders?.[0]?.folderPath || null,
    batchSize: job.batchSize || 50,
    concurrency: 1,
    importedCount: Number(job.importedCount || 0),
    skippedCount: Number(job.skippedCount || 0),
    errorCount: Number(job.errorCount || 0),
    remainingCount: 0,
    speedPerMinute: null,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    pausedAt: job.pausedAt,
    nextRunAt: null,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function defaultSyncIntervalForReport(account: any) {
  return account?.accountType === "LEAD_INTAKE" || /lead intake/i.test(String(account?.role || ""))
    ? "EVERY_15_MIN"
    : "EVERY_5_MIN";
}

function parseSchedulerConfigForReport(account: any) {
  const config = account?.schedulerConfig && typeof account.schedulerConfig === "object" && !Array.isArray(account.schedulerConfig)
    ? account.schedulerConfig as Record<string, unknown>
    : {};
  const fallbackInterval = defaultSyncIntervalForReport(account);
  const intervalCandidate = String(config.syncInterval || config.interval || fallbackInterval);
  const interval = INTERVALS[intervalCandidate] === undefined ? fallbackInterval : intervalCandidate;
  const batchSize = normalizeOption(Number(config.batchSize || account?.fetchLimit || 100), [50, 100, 250, 500], 100);
  const concurrency = normalizeOption(Number(config.concurrency || 2), [1, 2, 3, 5], 2);
  const autoSyncEnabled = typeof config.autoSyncEnabled === "boolean"
    ? config.autoSyncEnabled
    : Boolean(account?.autoSyncEnabled || interval !== "MANUAL");
  return {
    interval,
    intervalMs: INTERVALS[interval] || 0,
    batchSize,
    concurrency,
    autoSyncEnabled
  };
}

function nextAutoSyncAtForReport(account: any) {
  const scheduler = parseSchedulerConfigForReport(account);
  if (!scheduler.autoSyncEnabled || scheduler.intervalMs <= 0) return null;
  const lastSyncedAt = account?.lastSyncedAt instanceof Date ? account.lastSyncedAt : null;
  return new Date((lastSyncedAt?.getTime() || Date.now()) + scheduler.intervalMs);
}

function normalizeOption(value: number, allowed: number[], fallback: number) {
  return allowed.includes(value) ? value : fallback;
}

function deriveLeadStats(leadImportJob: any, start: Date, end: Date) {
  const folders = Array.isArray(leadImportJob?.folders) ? leadImportJob.folders : [];
  const parseFailed = folders.reduce((sum: number, folder: any) => sum + Number(folder.errorCount || 0), 0);
  const imported = Number(leadImportJob?.importedCount || 0);
  return {
    created: imported,
    updated: 0,
    merged: 0,
    parseFailed,
    start,
    end
  };
}

function buildActivity(jobs: any[], leadImportJobs: any[], logs: any[]) {
  const jobEvents = jobs.flatMap((job) => {
    const events = [
      {
        id: `${job.id}-start`,
        time: job.startedAt || job.updatedAt,
        title: `${job.triggerType} started`,
        detail: `${job.accountEmail} · ${job.folder}`
      }
    ];
    if (job.emailsNew) events.push({ id: `${job.id}-new`, time: job.updatedAt, title: "Imported emails", detail: `${job.emailsNew} new emails` });
    if (job.duplicateEmails) events.push({ id: `${job.id}-dupes`, time: job.updatedAt, title: "Skipped duplicate", detail: `${job.duplicateEmails} duplicate emails` });
    if (job.leadsCreated) events.push({ id: `${job.id}-leads`, time: job.updatedAt, title: "Lead Created", detail: `${job.leadsCreated} lead intake record(s)` });
    if (job.status === "FAILED") events.push({ id: `${job.id}-failed`, time: job.updatedAt, title: "Job Failed", detail: job.lastError || "No error details stored" });
    if (job.status === "COMPLETED") events.push({ id: `${job.id}-done`, time: job.completedAt || job.updatedAt, title: "Job Finished", detail: completionSummary(job) });
    return events;
  });

  const folderEvents = leadImportJobs.flatMap((job) =>
    (job.folders || []).slice(0, 3).map((folder: any) => ({
      id: `${job.id}-${folder.id}`,
      time: folder.updatedAt,
      title: folder.status === "COMPLETED" ? "Folder Complete" : "Folder Processing",
      detail: `${folder.folderPath}: ${folder.importedCount} new, ${folder.skippedCount} duplicate, ${folder.errorCount} failed`
    }))
  );

  const logEvents = logs.map((log) => ({
    id: log.id,
    time: log.createdAt,
    title: "Sync Log",
    detail: log.message
  }));

  return [...jobEvents, ...folderEvents, ...logEvents]
    .filter((event) => event.time)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 80);
}

function jobTypeLabel(jobType: string, leadImportJob: any, folder: string) {
  if (leadImportJob?.folders?.[0]?.sourceProviderName) return "Provider Folder";
  if (leadImportJob) return "Lead Intake";
  if (/sent/i.test(folder)) return "Sent Sync";
  if (/inbox/i.test(folder)) return "Inbox Sync";
  return jobType === "AUTO_SYNC" ? "Auto Sync" : "Manual Sync";
}

function completionSummary(job: any) {
  return `${job.emailsNew} emails imported, ${job.duplicateEmails} duplicates skipped, ${job.leadsCreated} leads created`;
}

function progressPercent(processed: number, remaining: number) {
  const total = processed + remaining;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
}

function estimateSpeed(processed: number, startedAt?: Date | null, endedAt?: Date | null) {
  if (!startedAt || processed <= 0) return 0;
  const elapsedMinutes = Math.max(((endedAt || new Date()).getTime() - startedAt.getTime()) / 60000, 1 / 60);
  return Math.round((processed / elapsedMinutes) * 10) / 10;
}

function estimateRemainingSeconds(remaining: number, speed?: number | null) {
  if (!remaining || !speed) return 0;
  return Math.round((remaining / speed) * 60);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return map;
}

function withinJobWindow(value: Date, start: Date, end: Date) {
  return value.getTime() >= start.getTime() - 1000 && value.getTime() <= end.getTime() + 1000;
}
