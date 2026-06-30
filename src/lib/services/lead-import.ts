import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { AddressObject } from "mailparser";
import type { EmailAccount, LeadImportFolder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountSecrets } from "@/lib/services/account";
import { logActivity } from "@/lib/services/activity";
import { mergeLeadByClientEmail } from "@/lib/services/lead-merge";
import { parseLeadIntakeEmail } from "@/lib/services/lead-parser";
import { findExistingLeadIdForLeadIntakeConversation } from "@/lib/services/lead-intake-grouping";

const DEFAULT_BATCH_SIZE = 100;
const SYSTEM_FOLDERS = new Set(["inbox", "sent", "sent items", "sent mail", "archive", "archives", "drafts", "trash", "junk", "spam"]);

export type ImapFolderNode = {
  name: string;
  path: string;
  delimiter: string;
  selectable: boolean;
  sourceProviderName: string | null;
  children: ImapFolderNode[];
};

type FlatFolder = {
  name: string;
  path: string;
  delimiter: string;
  selectable: boolean;
  sourceProviderName: string | null;
};

function createClient(account: EmailAccount, password: string) {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    logger: false,
    auth: {
      user: account.imapUser,
      pass: password
    }
  });
}

function firstAddress(value: AddressObject | undefined) {
  return value?.value[0];
}

export async function listImapFolders(accountId: string) {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Email account not found");

  const { imapPassword } = accountSecrets(account);
  const client = createClient(account, imapPassword);
  await client.connect();
  try {
    const mailboxes = await client.list();
    const flatFolders = mailboxes
      .map((mailbox: any) => {
        const path = String(mailbox.path || mailbox.name || "");
        const delimiter = String(mailbox.delimiter || "/");
        return {
          name: lastFolderName(path, delimiter),
          path,
          delimiter,
          selectable: !mailbox.flags?.has?.("\\Noselect") && !mailbox.noSelect,
          sourceProviderName: providerNameFromFolder(path, delimiter)
        } satisfies FlatFolder;
      })
      .filter((folder) => folder.path);
    return {
      account: { id: account.id, emailAddress: account.emailAddress },
      folders: buildFolderTree(flatFolders),
      flatFolders
    };
  } finally {
    await client.logout();
  }
}

export async function createLeadImportJob(input: { accountId: string; folderPaths: string[]; batchSize?: number }) {
  const account = await prisma.emailAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new Error("Email account not found");
  if (account.accountType !== "LEAD_INTAKE") throw new Error("Lead import jobs require a lead intake account.");
  await cleanupStaleLeadImportJobs(account.id);
  await prisma.leadImportJob.updateMany({
    where: { accountId: account.id, status: "RUNNING" },
    data: { status: "STALE", completedAt: new Date(), lastError: "Marked stale before starting a new import job." }
  });

  const selectedFolders = Array.from(new Set(input.folderPaths.filter(Boolean)));
  if (selectedFolders.length === 0) throw new Error("Select at least one folder to import.");

  const batchSize = Math.min(Math.max(input.batchSize || DEFAULT_BATCH_SIZE, 10), 500);
  const existingStates = await prisma.emailFolderSyncState.findMany({
    where: { accountId: account.id, folderPath: { in: selectedFolders } }
  });
  const stateByFolder = new Map(existingStates.map((state) => [state.folderPath, state]));
  const job = await prisma.leadImportJob.create({
    data: {
      accountId: account.id,
      accountEmail: account.emailAddress,
      selectedFolders,
      batchSize,
      folders: {
        create: selectedFolders.map((folderPath) => ({
          accountId: account.id,
          accountEmail: account.emailAddress,
          folderName: lastFolderName(folderPath),
          folderPath,
          lastUidImported: stateByFolder.get(folderPath)?.lastUid || 0,
          uidValidity: stateByFolder.get(folderPath)?.uidValidity,
          sourceProviderName: providerNameFromFolder(folderPath)
        }))
      }
    },
    include: { folders: true }
  });

  await logActivity({
    type: "MAIL_SYNC",
    message: `Lead import job created for ${account.emailAddress}`,
    metadata: { jobId: job.id, folderCount: selectedFolders.length, batchSize }
  });

  return job;
}

export async function getLeadImportJob(jobId: string) {
  return prisma.leadImportJob.findUnique({
    where: { id: jobId },
    include: { folders: { orderBy: { folderPath: "asc" } }, account: true }
  });
}

export async function cleanupStaleLeadImportJobs(accountId?: string) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.leadImportJob.updateMany({
    where: {
      ...(accountId ? { accountId } : {}),
      status: "RUNNING",
      updatedAt: { lt: cutoff }
    },
    data: {
      status: "STALE",
      completedAt: new Date(),
      lastError: "No progress for more than 5 minutes."
    }
  });
  await prisma.leadImportFolder.updateMany({
    where: {
      status: "RUNNING",
      updatedAt: { lt: cutoff },
      ...(accountId ? { accountId } : {})
    },
    data: {
      status: "STALE",
      lastError: "No progress for more than 5 minutes."
    }
  });
}

export async function pauseLeadImportJob(jobId: string) {
  return prisma.leadImportJob.update({
    where: { id: jobId },
    data: { status: "PAUSED", pausedAt: new Date() },
    include: { folders: { orderBy: { folderPath: "asc" } } }
  });
}

export async function resumeLeadImportJob(jobId: string) {
  return prisma.leadImportJob.update({
    where: { id: jobId },
    data: { status: "PENDING", pausedAt: null, completedAt: null },
    include: { folders: { orderBy: { folderPath: "asc" } } }
  });
}

export async function stopLeadImportJob(jobId: string) {
  const job = await prisma.leadImportJob.update({
    where: { id: jobId },
    data: { status: "STOPPED", completedAt: new Date(), lastError: "Stopped by user." },
    include: { folders: { orderBy: { folderPath: "asc" } } }
  });
  await prisma.leadImportFolder.updateMany({
    where: { jobId, status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
    data: { status: "STOPPED", lastError: "Stopped by user." }
  });
  return getLeadImportJob(job.id);
}

export async function retryFailedLeadImportJob(jobId: string) {
  const job = await prisma.leadImportJob.update({
    where: { id: jobId },
    data: { status: "PENDING", pausedAt: null, completedAt: null, lastError: null },
    include: { folders: { orderBy: { folderPath: "asc" } } }
  });
  await prisma.leadImportFolder.updateMany({
    where: { jobId, status: { in: ["FAILED", "STALE", "STOPPED"] } },
    data: { status: "PENDING", lastError: null }
  });
  return getLeadImportJob(job.id);
}

export async function clearCompletedLeadImportJobs(accountId?: string) {
  const result = await prisma.leadImportJob.updateMany({
    where: {
      ...(accountId ? { accountId } : {}),
      status: { in: ["COMPLETED", "FAILED", "STALE", "STOPPED"] }
    },
    data: { status: "ARCHIVED" }
  });
  return { updated: result.count };
}

export async function runLeadImportJobBatch(jobId: string) {
  const job = await getLeadImportJob(jobId);
  if (!job) throw new Error("Lead import job not found");
  await cleanupStaleLeadImportJobs(job.accountId);
  if (job.status === "PAUSED") return job;
  if (job.status === "COMPLETED") return job;
  if (["STOPPED", "STALE", "ARCHIVED"].includes(job.status)) return job;
  const otherRunning = await prisma.leadImportJob.findFirst({
    where: { accountId: job.accountId, status: "RUNNING", id: { not: job.id } },
    select: { id: true }
  });
  if (otherRunning) {
    await prisma.leadImportJob.update({
      where: { id: job.id },
      data: { status: "PENDING", lastError: "Another import job is already running for this account." }
    });
    return getLeadImportJob(job.id);
  }

  const account = job.account;
  const { imapPassword } = accountSecrets(account);
  const client = createClient(account, imapPassword);

  await prisma.leadImportJob.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt: job.startedAt || new Date(), lastError: null }
  });

  await client.connect();
  try {
    const nextFolder = job.folders.find((folder) => folder.status !== "COMPLETED");
    if (!nextFolder) return completeJob(job.id);

    await prisma.leadImportJob.update({
      where: { id: job.id },
      data: { currentFolderPath: nextFolder.folderPath }
    });

    await importFolderBatch({
      client,
      account,
      folder: nextFolder,
      batchSize: job.batchSize
    });

    await refreshJobCounts(job.id);
    return getLeadImportJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.leadImportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message, errorCount: { increment: 1 } }
    });
    throw error;
  } finally {
    await client.logout();
  }
}

export async function runLeadImportJobAuto(jobId: string) {
  const started = Date.now();
  let latest = await runLeadImportJobBatch(jobId);
  let batches = 1;

  while (
    latest &&
    latest.status === "RUNNING" &&
    latest.folders.some((folder) => folder.status !== "COMPLETED") &&
    Date.now() - started < 25_000 &&
    batches < 10
  ) {
    latest = await runLeadImportJobBatch(jobId);
    batches += 1;
  }

  if (latest) await refreshJobCounts(latest.id);
  return getLeadImportJob(jobId);
}

async function importFolderBatch(input: {
  client: ImapFlow;
  account: EmailAccount;
  folder: LeadImportFolder;
  batchSize: number;
}) {
  const { client, account, folder, batchSize } = input;
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const lock = await client.getMailboxLock(folder.folderPath);
  try {
    const mailbox = client.mailbox as any;
    const exists = Number(mailbox?.exists || 0);
    const uidValidity = Number(mailbox?.uidValidity || mailbox?.uidvalidity || 0) || undefined;
    const uidNext = Number(mailbox?.uidNext || mailbox?.uidnext || 0) || undefined;
    const isHeavyFolder = isHeavyLeadFolder(folder.folderPath, exists);
    const safeBatchSize = isHeavyFolder ? Math.min(batchSize, 50) : batchSize;
    const resetCursor = Boolean(folder.uidValidity && uidValidity && folder.uidValidity !== uidValidity);
    const latestUid = Math.max((uidNext || 1) - 1, 1);
    const heavyEndUid = Math.max(resetCursor || !folder.lastUidImported ? latestUid : folder.lastUidImported - 1, 1);
    const heavyStartUid = Math.max(1, heavyEndUid - safeBatchSize + 1);
    const fromUid = isHeavyFolder ? heavyStartUid : Math.max((resetCursor ? 0 : folder.lastUidImported || 0) + 1, 1);
    const toUid = isHeavyFolder ? heavyEndUid : "*";
    if (!exists) {
      await markFolderCompleted(folder.id, uidValidity);
      await upsertFolderSyncState(account, folder, {
        uidValidity,
        lastSyncedAt: new Date(),
        status: "COMPLETED"
      });
      return;
    }

    await prisma.leadImportFolder.update({
      where: { id: folder.id },
      data: {
        status: "RUNNING",
        startedAt: folder.startedAt || new Date(),
        uidValidity,
        lastUidImported: isHeavyFolder ? heavyEndUid : resetCursor ? 0 : folder.lastUidImported,
        lastError: isHeavyFolder
          ? `Heavy folder mode enabled. Current UID range ${fromUid}:${toUid}. Resume point ${fromUid}.`
          : null
      }
    });
    await upsertFolderSyncState(account, folder, {
      uidValidity,
      status: resetCursor ? "REBUILDING" : "RUNNING",
      lastError: null
    });

    let processed = 0;
    let highestUid = isHeavyFolder ? heavyEndUid : folder.lastUidImported || 0;
    const batchStartedAt = Date.now();

    for await (const message of client.fetch(`${fromUid}:${toUid}`, { envelope: true, source: true, uid: true }, { uid: true })) {
      if (processed >= safeBatchSize || Date.now() - batchStartedAt >= 20_000) break;
      processed += 1;
      highestUid = Math.max(highestUid, Number(message.uid || 0));
      if (!message.source) {
        skipped += 1;
        continue;
      }

      try {
        const result = await importLeadMessage({
          account,
          folder,
          source: message.source,
          uid: Number(message.uid || 0)
        });
        if (result === "imported") imported += 1;
        else skipped += 1;
      } catch (error) {
        errors += 1;
        await storeFailedLeadIntake({
          account,
          folder,
          source: message.source,
          uid: Number(message.uid || 0),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const status = isHeavyFolder
      ? fromUid <= 1 || processed === 0 ? "COMPLETED" : "RUNNING"
      : processed < safeBatchSize ? "COMPLETED" : "RUNNING";
    const lastUid = isHeavyFolder ? Math.max(fromUid, 1) : Math.max(highestUid, resetCursor ? 0 : folder.lastUidImported || 0);
    await prisma.leadImportFolder.update({
      where: { id: folder.id },
      data: {
        status,
        lastUidImported: lastUid,
        importedCount: { increment: imported },
        skippedCount: { increment: skipped },
        errorCount: { increment: errors },
        completedAt: status === "COMPLETED" ? new Date() : null,
        lastError: isHeavyFolder
          ? `Heavy folder mode enabled. Current UID range ${fromUid}:${toUid}. Batch scanned ${processed}. Resume point ${lastUid}.`
          : processed === 0
            ? "No new emails found"
            : imported === 0 && skipped > 0 && errors === 0
              ? "Skipped duplicate emails"
              : null
      }
    });
    await upsertFolderSyncState(account, folder, {
      uidValidity,
      lastUid,
      highestUid: isHeavyFolder ? Math.max(highestUid, latestUid) : lastUid,
      lastSyncedAt: new Date(),
      status,
      importedCount: { increment: imported },
      skippedCount: { increment: skipped },
      errorCount: { increment: errors }
    });
  } finally {
    lock.release();
  }
}

function isHeavyLeadFolder(folderPath: string, exists: number) {
  return /^inbox$/i.test(folderPath) || exists >= 1000;
}

async function upsertFolderSyncState(
  account: EmailAccount,
  folder: Pick<LeadImportFolder, "folderPath" | "sourceProviderName">,
  data: Record<string, unknown>
) {
  const { createData, updateData } = splitFolderSyncStateData(data);
  return prisma.emailFolderSyncState.upsert({
    where: { accountId_folderPath: { accountId: account.id, folderPath: folder.folderPath } },
    create: {
      accountId: account.id,
      accountEmail: account.emailAddress,
      folderPath: folder.folderPath,
      folderRole: folder.sourceProviderName ? "LEAD_PROVIDER" : "LEAD",
      ...createData
    } as any,
    update: {
      accountEmail: account.emailAddress,
      folderRole: folder.sourceProviderName ? "LEAD_PROVIDER" : "LEAD",
      ...updateData
    } as any
  });
}

function splitFolderSyncStateData(data: Record<string, unknown>) {
  const createData = { ...data } as Record<string, unknown>;
  const updateData = { ...data } as Record<string, unknown>;
  for (const key of ["importedCount", "skippedCount", "errorCount"]) {
    const value = data[key] as { increment?: unknown } | number | undefined;
    if (value && typeof value === "object" && "increment" in value) {
      createData[key] = Number(value.increment || 0);
      updateData[key] = { increment: Number(value.increment || 0) };
    } else if (typeof value === "number") {
      createData[key] = value || 0;
      updateData[key] = { increment: value || 0 };
    }
  }
  return { createData, updateData };
}

async function importLeadMessage(input: {
  account: EmailAccount;
  folder: LeadImportFolder;
  source: Buffer;
  uid: number;
}) {
  const { account, folder, source, uid } = input;
  const parsed = await simpleParser(source);
  const messageId = parsed.messageId || `${account.emailAddress}-${folder.folderPath}-${uid}`;
  const existing = await prisma.leadIntake.findFirst({
    where: {
      accountEmail: account.emailAddress,
      sourceFolderPath: folder.folderPath,
      messageId
    }
  });
  if (existing) return "skipped";

  const fromAddress = firstAddress(parsed.from);
  const fromEmail = (fromAddress?.address || account.emailAddress).toLowerCase();
  const receivedAt = parsed.date || new Date();
  const subject = parsed.subject || "(no subject)";
  const rawText = parsed.text || "";
  const parsedLead = parseLeadIntakeEmail({
    text: rawText,
    html: typeof parsed.html === "string" ? parsed.html : undefined,
    fromEmail,
    fromName: fromAddress?.name,
    internalDomain: account.internalDomain,
    sourceFolder: folder.folderName,
    sourceFolderPath: folder.folderPath,
    sourceProviderName: folder.sourceProviderName
  });
  const needsManualConfirmation = parsedLead.confidence < 80 || !parsedLead.clientEmail;
  const intakeStatus = parsedLead.reviewerDecision?.sandipReviewRequired
    ? "WAITING_FOR_SANDIP" as const
    : leadStatusForParsedIntake(parsedLead.detectedIntent);
  let leadId: string | undefined;

  if (parsedLead.clientEmail && !needsManualConfirmation) {
    const existingConversationLeadId = await findExistingLeadIdForLeadIntakeConversation(prisma, {
      clientEmail: parsedLead.clientEmail,
      originalSubject: parsedLead.originalSubject,
      subject,
      website: parsedLead.website
    });
    const lead = await prisma.$transaction((tx) =>
      mergeLeadByClientEmail(tx, {
        clientEmail: parsedLead.clientEmail!,
        name: parsedLead.name,
        company: parsedLead.company,
        phone: parsedLead.phone,
        website: parsedLead.website,
        country: parsedLead.country,
        service: parsedLead.service,
        source: "lead_import",
        status: intakeStatus,
        originalClientMessage: parsedLead.latestClientMessage || parsedLead.originalClientMessage,
        clientEmailConfidence: parsedLead.confidence,
        clientEmailReason: parsedLead.reason
      })
    );
    leadId = existingConversationLeadId || lead.id;
  }

  await prisma.leadIntake.create({
    data: {
      accountId: account.id,
      accountEmail: account.emailAddress,
      leadId,
      messageId,
      fromEmail,
      fromName: fromAddress?.name,
      subject,
      rawText,
      rawHtml: typeof parsed.html === "string" ? parsed.html : undefined,
      rawEmail: source.toString("utf8").slice(0, 200000),
      leadGeneratorEmail: fromEmail,
      extractedName: parsedLead.name,
      extractedClientEmail: parsedLead.clientEmail,
      extractedWebsite: parsedLead.website,
      extractedPhone: parsedLead.phone,
      extractedCountry: parsedLead.country,
      extractedService: parsedLead.service,
      extractedCompany: parsedLead.company,
      forwardedClientMessage: parsedLead.forwardedClientMessage,
      originalClientMessage: parsedLead.originalClientMessage,
      originalClientName: parsedLead.originalClientName,
      originalClientEmail: parsedLead.originalClientEmail,
      originalClientPhone: parsedLead.originalClientPhone,
      originalWebsite: parsedLead.originalWebsite,
      originalCompany: parsedLead.originalCompany,
      originalSubject: parsedLead.originalSubject,
      originalConversationText: parsedLead.originalConversationText,
      latestClientMessage: parsedLead.latestClientMessage,
      previousProviderMessages: parsedLead.previousProviderMessages,
      fullForwardedChain: parsedLead.fullForwardedChain,
      detectedIntent: parsedLead.detectedIntent,
      requestedItems: parsedLead.requestedItems,
      recommendedReplyType: parsedLead.recommendedReplyType,
      leadSourceType: parsedLead.leadSourceType,
      conversationType: parsedLead.conversationType,
      replyMode: parsedLead.replyMode,
      forwardedBy: parsedLead.forwardedBy,
      providerEmail: parsedLead.providerEmail,
      sourceFolder: folder.folderName,
      sourceFolderPath: folder.folderPath,
      sourceProviderName: folder.sourceProviderName,
      detectedProviderName: parsedLead.leadProvider || detectProviderFromText(rawText),
      rejectedEmails: parsedLead.rejectedEmails,
      extractionConfidence: parsedLead.confidence,
      extractionReason: parsedLead.reason,
      parsingStatus: "PARSED",
      needsManualConfirmation,
      approvalStatus: parsedLead.reviewerDecision?.approvalStatus,
      sandipReviewRequired: parsedLead.reviewerDecision?.sandipReviewRequired || false,
      sandipDecisionStatus: parsedLead.reviewerDecision?.sandipDecisionStatus,
      reviewerEmail: parsedLead.reviewerDecision ? fromEmail : undefined,
      reviewerComment: parsedLead.reviewerDecision?.reviewerComment,
      reviewerCommentAt: parsedLead.reviewerDecision ? receivedAt : undefined,
      status: intakeStatus,
      receivedAt
    }
  });

  return "imported";
}

function leadStatusForParsedIntake(intent?: string | null) {
  if (!intent || intent === "UNKNOWN") return "WAITING_FOR_SANDIP" as const;
  if (intent === "NOT_INTERESTED") return "HOLD" as const;
  return "NEEDS_REPLY" as const;
}

async function storeFailedLeadIntake(input: {
  account: EmailAccount;
  folder: LeadImportFolder;
  source: Buffer;
  uid: number;
  error: string;
}) {
  const messageId = `${input.account.emailAddress}-${input.folder.folderPath}-${input.uid}-parse-failed`;
  await prisma.leadIntake.upsert({
    where: {
      accountEmail_sourceFolderPath_messageId: {
        accountEmail: input.account.emailAddress,
        sourceFolderPath: input.folder.folderPath,
        messageId
      }
    },
    create: {
      accountId: input.account.id,
      accountEmail: input.account.emailAddress,
      messageId,
      fromEmail: input.account.emailAddress,
      subject: "(parse failed)",
      rawEmail: input.source.toString("utf8").slice(0, 200000),
      sourceFolder: input.folder.folderName,
      sourceFolderPath: input.folder.folderPath,
      sourceProviderName: input.folder.sourceProviderName,
      extractionConfidence: 0,
      extractionReason: input.error,
      parsingStatus: "FAILED",
      needsManualConfirmation: true,
      status: "WAITING_FOR_SANDIP",
      receivedAt: new Date()
    },
    update: {
      rawEmail: input.source.toString("utf8").slice(0, 200000),
      extractionReason: input.error,
      parsingStatus: "FAILED"
    }
  });
}

async function markFolderCompleted(folderId: string, uidValidity?: number) {
  await prisma.leadImportFolder.update({
    where: { id: folderId },
    data: { status: "COMPLETED", uidValidity, completedAt: new Date() }
  });
}

async function refreshJobCounts(jobId: string) {
  const folders = await prisma.leadImportFolder.findMany({ where: { jobId } });
  const importedCount = folders.reduce((sum, folder) => sum + folder.importedCount, 0);
  const skippedCount = folders.reduce((sum, folder) => sum + folder.skippedCount, 0);
  const errorCount = folders.reduce((sum, folder) => sum + folder.errorCount, 0);
  const complete = folders.every((folder) => folder.status === "COMPLETED");
  const failed = folders.some((folder) => folder.status === "FAILED");
  return prisma.leadImportJob.update({
    where: { id: jobId },
    data: {
      importedCount,
      skippedCount,
      errorCount,
      status: complete ? "COMPLETED" : failed ? "FAILED" : "RUNNING",
      completedAt: complete || failed ? new Date() : null,
      lastError: complete
        ? importedCount === 0 && skippedCount > 0 && errorCount === 0
          ? "No new emails found. Skipped duplicate emails."
          : "Import completed"
        : "Processing next folder automatically..."
    }
  });
}

async function completeJob(jobId: string) {
  await refreshJobCounts(jobId);
  return getLeadImportJob(jobId);
}

function buildFolderTree(flatFolders: FlatFolder[]) {
  const root: ImapFolderNode[] = [];
  const nodes = new Map<string, ImapFolderNode>();

  for (const folder of flatFolders) {
    const node: ImapFolderNode = { ...folder, children: [] };
    nodes.set(folder.path, node);
  }

  for (const folder of flatFolders) {
    const node = nodes.get(folder.path)!;
    const parentPath = parentFolderPath(folder.path, folder.delimiter);
    const parent = parentPath ? nodes.get(parentPath) : null;
    if (parent) parent.children.push(node);
    else root.push(node);
  }

  return root;
}

function parentFolderPath(path: string, delimiter = "/") {
  const index = path.lastIndexOf(delimiter);
  return index > 0 ? path.slice(0, index) : null;
}

function lastFolderName(path: string, delimiter = "/") {
  const parts = path.split(delimiter).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function providerNameFromFolder(path: string, delimiter = "/") {
  const name = lastFolderName(path, delimiter);
  return SYSTEM_FOLDERS.has(name.toLowerCase()) ? null : name;
}

function detectProviderFromText(text: string) {
  const match = text.match(/(?:provider|lead provider|source)\s*[:-]\s*([^\n,;]+)/i);
  return match?.[1]?.trim() || null;
}
