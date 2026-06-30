import { ImapFlow } from "imapflow";
import { createHash } from "crypto";
import { simpleParser } from "mailparser";
import type { AddressObject } from "mailparser";
import type { EmailAccount, EmailDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountSecrets, getAccountByType, getActiveAccount } from "@/lib/services/account";
import { logActivity } from "@/lib/services/activity";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { mergeLeadByClientEmail } from "@/lib/services/lead-merge";
import { findExistingLeadIdForLeadIntakeConversation } from "@/lib/services/lead-intake-grouping";
import { parseLeadIntakeEmail } from "@/lib/services/lead-parser";
import { findOrCreateLead, normalizeSubject, snippetFromText, upsertThread } from "@/lib/services/threading";

const SENT_FOLDER_CANDIDATES = ["Sent", "Sent Items", "INBOX.Sent", "Sent Messages", "Sent Mail"];

function addressList(value: AddressObject | AddressObject[] | undefined) {
  if (!value) return [];
  const addresses = Array.isArray(value) ? value : [value];
  return addresses.flatMap((entry) =>
    entry.value.map((item) => item.address?.toLowerCase()).filter((item): item is string => Boolean(item))
  );
}

function firstAddress(value: AddressObject | undefined) {
  return value?.value[0];
}

function referenceString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(" ") : value;
}

function isExcludedEmail(email: string, account: EmailAccount) {
  const normalized = email.toLowerCase();
  const domain = normalized.split("@")[1] || "";
  return (
    normalized.endsWith(`@${account.internalDomain.toLowerCase()}`) ||
    account.excludedEmails.map((item) => item.toLowerCase()).includes(normalized) ||
    account.excludedDomains.map((item) => item.toLowerCase()).includes(domain)
  );
}

function detectAutoReply(subject: string, headers?: Map<string, string | string[]>) {
  const lowered = subject.toLowerCase();
  const autoSubmitted = String(headers?.get("auto-submitted") || "").toLowerCase();
  const precedence = String(headers?.get("precedence") || "").toLowerCase();
  return (
    lowered.includes("automatic reply") ||
    lowered.includes("out of office") ||
    autoSubmitted.includes("auto") ||
    precedence.includes("bulk") ||
    precedence.includes("list")
  );
}

function detectBounce(subject: string, fromEmail: string) {
  const lowered = subject.toLowerCase();
  return (
    lowered.includes("delivery failure") ||
    lowered.includes("delivery failed") ||
    lowered.includes("undeliverable") ||
    lowered.includes("mail delivery failed") ||
    fromEmail.includes("mailer-daemon") ||
    fromEmail.includes("postmaster")
  );
}

function followupStageFor(lastOutboundAt: Date, previousStage: number) {
  const elapsedMs = Date.now() - lastOutboundAt.getTime();
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  if (elapsedDays >= 20) return Math.max(previousStage, 4);
  if (elapsedDays >= 10) return Math.max(previousStage, 3);
  if (elapsedDays >= 5) return Math.max(previousStage, 2);
  if (elapsedDays >= 2) return Math.max(previousStage, 1);
  return previousStage;
}

function nextFollowupDate(lastOutboundAt: Date, stage: number) {
  const days = stage <= 0 ? 2 : stage === 1 ? 5 : stage === 2 ? 10 : 20;
  const next = new Date(lastOutboundAt);
  next.setDate(next.getDate() + days);
  return next;
}

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

async function detectSentFolder(client: ImapFlow, configured?: string | null) {
  if (configured) return configured;
  const mailboxes = await client.list();
  const paths = mailboxes.map((mailbox: any) => String(mailbox.path || mailbox.name || ""));
  return SENT_FOLDER_CANDIDATES.find((candidate) => paths.includes(candidate)) || paths.find((path) =>
    /sent/i.test(path)
  );
}

async function getFolderSyncState(account: EmailAccount, folderPath: string, folderRole?: string) {
  return prisma.emailFolderSyncState.upsert({
    where: { accountId_folderPath: { accountId: account.id, folderPath } },
    create: {
      accountId: account.id,
      accountEmail: account.emailAddress,
      folderPath,
      folderRole
    },
    update: {
      accountEmail: account.emailAddress,
      folderRole
    }
  });
}

async function updateFolderSyncState(account: EmailAccount, folderPath: string, data: Record<string, unknown>) {
  const { createData, updateData } = splitFolderSyncStateData(data);
  return prisma.emailFolderSyncState.upsert({
    where: { accountId_folderPath: { accountId: account.id, folderPath } },
    create: {
      accountId: account.id,
      accountEmail: account.emailAddress,
      folderPath,
      ...createData
    } as any,
    update: {
      accountEmail: account.emailAddress,
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

function createDuplicateHash(input: {
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  sentAt: Date;
}) {
  return createHash("sha256")
    .update(
      [
        input.fromEmail.toLowerCase(),
        [...input.toEmails, ...input.ccEmails, ...input.bccEmails].sort().join(","),
        normalizeSubject(input.subject),
        input.sentAt.toISOString()
      ].join("|")
    )
    .digest("hex");
}

async function importFolder(input: {
  client: ImapFlow;
  account: EmailAccount;
  folder: string;
  direction: EmailDirection;
  batchSize: number;
}) {
  const { client, account, folder, direction, batchSize } = input;
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let highestUid = 0;
  let remaining = 0;
  const lock = await client.getMailboxLock(folder);
  try {
    const mailbox = client.mailbox as any;
    const exists = Number(mailbox?.exists || 0);
    const uidValidity = Number(mailbox?.uidValidity || mailbox?.uidvalidity || 0) || undefined;
    const uidNext = Number(mailbox?.uidNext || mailbox?.uidnext || 0) || undefined;
    const role = direction === "INBOUND" ? "INBOX" : "SENT";
    const state = await getFolderSyncState(account, folder, role);
    const resetCursor = Boolean(state.uidValidity && uidValidity && state.uidValidity !== uidValidity);
    const fromUid = Math.max((resetCursor ? 0 : state.lastUid) + 1, 1);
    highestUid = resetCursor ? 0 : state.highestUid;

    if (!exists) {
      await updateFolderSyncState(account, folder, {
        folderRole: role,
        uidValidity,
        lastSyncedAt: new Date(),
        status: "COMPLETED"
      });
      return { imported, skipped, errors, highestUid, remaining };
    }

    await updateFolderSyncState(account, folder, {
      folderRole: role,
      uidValidity,
      status: resetCursor ? "REBUILDING" : "RUNNING",
      lastError: null
    });

    let processed = 0;
    for await (const message of client.fetch(`${fromUid}:*`, { envelope: true, source: true, uid: true }, { uid: true })) {
      if (processed >= batchSize) break;
      processed += 1;
      const uid = Number(message.uid || 0);
      highestUid = Math.max(highestUid, uid);
      if (!message.source) {
        skipped += 1;
        continue;
      }
      try {
        const parsed = await simpleParser(message.source);
        const messageId = parsed.messageId || `${account.emailAddress}-${folder}-${uid}`;
        const sentAt = parsed.date || new Date();
        const fromAddress = firstAddress(parsed.from);
        const fromEmail = (fromAddress?.address || account.emailAddress).toLowerCase();
        const toEmails = addressList(parsed.to);
        const ccEmails = addressList(parsed.cc);
        const bccEmails = addressList(parsed.bcc);
        const subject = parsed.subject || "(no subject)";
        const hash = createDuplicateHash({ fromEmail, toEmails, ccEmails, bccEmails, subject, sentAt });
        const existing = await prisma.email.findFirst({
          where: {
            accountId: account.id,
            OR: [
              { messageId },
              uid ? { sourceFolderPath: folder, imapUid: uid } : undefined,
              { duplicateHash: hash }
            ].filter(Boolean) as any
          },
          select: { id: true }
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        const references = referenceString(parsed.references);
        const isAutoReply = detectAutoReply(subject, parsed.headers as Map<string, string | string[]>);
        const isBounce = detectBounce(subject, fromEmail);
        const externalEmail =
          direction === "INBOUND"
            ? fromEmail
            : [...toEmails, ...ccEmails, ...bccEmails].find((email) => !isExcludedEmail(email, account));

        if (!externalEmail || isExcludedEmail(externalEmail, account) || isAutoReply || isBounce) {
          skipped += 1;
          continue;
        }

        const lead = await findOrCreateLead({
          email: externalEmail,
          name: direction === "INBOUND" ? fromAddress?.name : undefined
        });
        const thread = await upsertThread({
          accountId: account.id,
          leadId: lead.id,
          subject,
          externalEmail,
          lastMessageAt: sentAt,
          references,
          inReplyTo: parsed.inReplyTo
        });

        await prisma.email.create({
          data: {
            accountId: account.id,
            threadId: thread.id,
            direction,
            folder,
            sourceFolder: folder,
            sourceFolderPath: folder,
            sourceProviderName: null,
            imapUid: uid || undefined,
            duplicateHash: hash,
            messageId,
            inReplyTo: parsed.inReplyTo,
            references,
            fromName: fromAddress?.name,
            fromEmail,
            toEmails,
            ccEmails,
            bccEmails,
            subject,
            normalizedSubject: normalizeSubject(subject),
            snippet: snippetFromText(parsed.text),
            textBody: parsed.text,
            htmlBody: typeof parsed.html === "string" ? parsed.html : undefined,
            attachmentMetadata: parsed.attachments.map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size
            })),
            sentAt,
            receivedAt: direction === "INBOUND" ? sentAt : undefined,
            isAutoReply,
            isBounce
          }
        });

        await prisma.emailThread.update({
          where: { id: thread.id },
          data: {
            lastMessageAt: sentAt,
            messageCount: { increment: 1 }
          }
        });
        await prisma.lead.update({
          where: { id: lead.id },
          data:
                direction === "INBOUND"
              ? {
                  lastInboundAt: sentAt,
                  waitingForReply: false,
                  status: "REPLIED",
                  nextFollowUpAt: null,
                  followupState: FOLLOWUP_STATES.CLIENT_REPLIED,
                  followupStateUpdatedAt: new Date()
                }
              : {
                  lastOutboundAt: sentAt,
                  waitingForReply: true
                }
        });
        imported += 1;
      } catch (error) {
        errors += 1;
        await updateFolderSyncState(account, folder, {
          lastError: error instanceof Error ? error.message : String(error)
        });
      }
    }
    remaining = Math.max(0, (uidNext || highestUid + 1) - highestUid - 1);
    await updateFolderSyncState(account, folder, {
      folderRole: role,
      lastUid: highestUid,
      highestUid,
      uidValidity,
      lastSyncedAt: new Date(),
      status: processed < batchSize ? "COMPLETED" : "RUNNING",
      importedCount: { increment: imported },
      skippedCount: { increment: skipped },
      errorCount: { increment: errors }
    });
    return { imported, skipped, errors, highestUid, remaining };
  } finally {
    lock.release();
  }
}

async function importLeadIntakeFolder(input: {
  client: ImapFlow;
  account: EmailAccount;
  folder: string;
  limit: number;
  forceLatest?: boolean;
}) {
  const { client, account, folder, limit, forceLatest = false } = input;
  let imported = 0;
  let skipped = 0;
  let needsReview = 0;
  let highestUid = 0;
  const lock = await client.getMailboxLock(folder);
  try {
    const mailbox = client.mailbox as any;
    const exists = Number(mailbox?.exists || 0);
    const uidValidity = Number(mailbox?.uidValidity || mailbox?.uidvalidity || 0) || undefined;
    const uidNext = Number(mailbox?.uidNext || mailbox?.uidnext || 0) || undefined;
    const state = await getFolderSyncState(account, folder, "LEAD_INTAKE");
    const uidValidityChanged = Boolean(state.uidValidity && uidValidity && state.uidValidity !== uidValidity);
    const uidCursorAhead = Boolean(uidNext && state.lastUid && state.lastUid >= uidNext);
    const canUseUidCursor = Boolean(!forceLatest && !uidValidityChanged && !uidCursorAhead && state?.lastUid && (!state.uidValidity || !uidValidity || state.uidValidity === uidValidity));
    const range = forceLatest || uidValidityChanged || uidCursorAhead
      ? exists > 0
        ? `${Math.max(1, exists - limit + 1)}:*`
        : ""
      : canUseUidCursor
      ? `${Number(state?.lastUid || 0) + 1}:*`
      : exists > 0
        ? `${Math.max(1, exists - limit + 1)}:*`
        : "";
    const fetchOptions = canUseUidCursor ? { uid: true } : undefined;
    if (!range) return { imported, skipped, needsReview, updated: 0 };
    await updateFolderSyncState(account, folder, {
      folderRole: "LEAD_INTAKE",
      uidValidity,
      status: "RUNNING",
      lastError: uidValidityChanged
        ? "UIDVALIDITY changed. Safely checking latest messages."
        : uidCursorAhead
          ? "UID cursor was ahead of mailbox. Safely checking latest messages."
          : null
    });

    let processed = 0;
    for await (const message of client.fetch(range, { envelope: true, source: true, uid: true }, fetchOptions)) {
      if (processed >= limit) break;
      processed += 1;
      highestUid = Math.max(highestUid, Number(message.uid || 0));
      if (!message.source) {
        skipped += 1;
        continue;
      }

      try {
      const parsed = await simpleParser(message.source);
      const messageId = parsed.messageId || `${account.emailAddress}-${folder}-${message.uid}`;
      const existing = await prisma.leadIntake.findFirst({
        where: {
          OR: [
            { accountEmail: account.emailAddress, sourceFolderPath: folder, messageId },
            { accountId: account.id, sourceFolderPath: folder, messageId }
          ]
        },
        select: { id: true }
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const fromAddress = firstAddress(parsed.from);
      const fromEmail = (fromAddress?.address || account.emailAddress).toLowerCase();
      const receivedAt = parsed.date || new Date();
      const subject = parsed.subject || "(no subject)";
      const parsedLead = parseLeadIntakeEmail({
        text: parsed.text,
        html: typeof parsed.html === "string" ? parsed.html : undefined,
        fromEmail,
        fromName: fromAddress?.name,
        internalDomain: account.internalDomain,
        sourceFolder: folder,
        sourceFolderPath: folder,
        sourceProviderName: null
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
            source: "lead_intake",
            status: intakeStatus,
            originalClientMessage: parsedLead.latestClientMessage || parsedLead.originalClientMessage,
            clientEmailConfidence: parsedLead.confidence,
            clientEmailReason: parsedLead.reason
          })
        );
        leadId = existingConversationLeadId || lead.id;
      } else {
        needsReview += 1;
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
          rawText: parsed.text,
          rawHtml: typeof parsed.html === "string" ? parsed.html : undefined,
          rawEmail: message.source.toString("utf8").slice(0, 200000),
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
          sourceFolder: folder,
          sourceFolderPath: folder,
          sourceProviderName: null,
          detectedProviderName: parsedLead.leadProvider,
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

      imported += 1;
      } catch (error) {
        skipped += 1;
        await updateFolderSyncState(account, folder, {
          folderRole: "LEAD_INTAKE",
          uidValidity,
          lastError: error instanceof Error ? error.message : String(error),
          errorCount: { increment: 1 }
        });
      }
    }

    if (highestUid > 0) {
      await updateFolderSyncState(account, folder, {
        folderRole: "LEAD_INTAKE",
        uidValidity,
        lastUid: uidCursorAhead || uidValidityChanged ? highestUid : Math.max(highestUid, state.lastUid || 0),
        highestUid: uidCursorAhead || uidValidityChanged ? highestUid : Math.max(highestUid, state.highestUid || 0),
        lastSyncedAt: new Date(),
        status: "COMPLETED",
        importedCount: { increment: imported },
        skippedCount: { increment: skipped },
        errorCount: { increment: 0 }
      });
    }

    return { imported, skipped, needsReview, updated: 0 };
  } finally {
    lock.release();
  }
}

function leadStatusForParsedIntake(intent?: string | null) {
  if (!intent || intent === "UNKNOWN") return "WAITING_FOR_SANDIP" as const;
  if (intent === "NOT_INTERESTED") return "HOLD" as const;
  return "NEEDS_REPLY" as const;
}

export async function updateNoReplyLeads() {
  const leads = await prisma.lead.findMany({
    where: { lastOutboundAt: { not: null } },
    include: { threads: { include: { emails: true } } }
  });
  let waiting = 0;
  let replies = 0;

  for (const lead of leads) {
    const emails = lead.threads.flatMap((thread) => thread.emails);
    const latestOutbound = emails
      .filter((email) => email.direction === "OUTBOUND" && !email.isBounce && !email.isAutoReply)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    if (!latestOutbound) continue;
    const replyAfter = emails.some(
      (email) =>
        email.direction === "INBOUND" &&
        !email.isBounce &&
        !email.isAutoReply &&
        email.sentAt.getTime() > latestOutbound.sentAt.getTime()
    );
    if (replyAfter) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          waitingForReply: false,
          status: "REPLIED",
          lastInboundAt:
            emails
              .filter((email) => email.direction === "INBOUND")
              .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0]?.sentAt || lead.lastInboundAt,
          nextFollowUpAt: null,
          followupState: FOLLOWUP_STATES.CLIENT_REPLIED,
          followupStateUpdatedAt: new Date()
        }
      });
      replies += 1;
      continue;
    }

    const stage = followupStageFor(latestOutbound.sentAt, lead.followupStage);
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        waitingForReply: true,
        status: stage > 0 ? "FOLLOW_UP_NEEDED" : lead.status,
        followupStage: stage,
        lastOutboundAt: latestOutbound.sentAt,
        nextFollowUpAt: nextFollowupDate(latestOutbound.sentAt, stage),
        followupState: nextFollowupDate(latestOutbound.sentAt, stage) <= new Date() ? FOLLOWUP_STATES.DUE : FOLLOWUP_STATES.SENT_WAITING_REPLY,
        followupStateUpdatedAt: new Date()
      }
    });
    waiting += 1;
  }
  return { waiting, replies };
}

export async function syncEmailAccount(accountId: string, options: { batchSize?: number } = {}) {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Email account not found");
  const { imapPassword } = accountSecrets(account);
  const batchSize = Math.min(Math.max(options.batchSize || account.fetchLimit || 100, 20), 500);
  const client = createClient(account, imapPassword);

  await client.connect();
  try {
    const sentFolder = await detectSentFolder(client, account.sentFolder);
    const inbox = await importFolder({
      client,
      account,
      folder: account.inboxFolder || "INBOX",
      direction: "INBOUND",
      batchSize
    });
    const sent = sentFolder
      ? await importFolder({
          client,
          account,
          folder: sentFolder,
          direction: "OUTBOUND",
          batchSize
        })
      : { imported: 0, skipped: 0, errors: 0, remaining: 0 };
    const noReply = await updateNoReplyLeads();

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        sentFolder: sentFolder || account.sentFolder
      }
    });
    await logActivity({
      type: "MAIL_SYNC",
      message: `Synced email: ${inbox.imported} inbox, ${sent.imported} sent, ${noReply.waiting} waiting`,
      metadata: { inbox, sent, noReply, batchSize, sentFolder, account: account.emailAddress }
    });

    return { inbox, sent, noReply, fetchLimit: batchSize, sentFolder, account: account.emailAddress };
  } finally {
    await client.logout();
  }
}

export async function syncEmails(limit?: number) {
  const account = await getActiveAccount();
  return syncEmailAccount(account.id, { batchSize: limit });
}

export async function syncLeadIntakeEmails(limit?: number, accountIdOrEmail?: string, options: { forceLatest?: boolean } = {}) {
  const startedAt = new Date();
  const account = accountIdOrEmail
    ? await prisma.emailAccount.findFirst({
        where: {
          isActive: true,
          OR: [
            { id: accountIdOrEmail },
            { emailAddress: { equals: accountIdOrEmail, mode: "insensitive" } }
          ]
        }
      })
    : await getAccountByType("LEAD_INTAKE");
  if (!account) throw new Error("Lead intake account not found");
  if (account.accountType !== "LEAD_INTAKE") {
    return { imported: 0, skipped: 0, needsReview: 0, configured: false };
  }

  const { imapPassword } = accountSecrets(account);
  const fetchLimit = Math.min(Math.max(limit || account.fetchLimit || 50, 20), 500);
  const client = createClient(account, imapPassword);

  await client.connect();
  try {
    const inbox = await importLeadIntakeFolder({
      client,
      account,
      folder: account.inboxFolder || "INBOX",
      limit: options.forceLatest ? Math.max(fetchLimit, 100) : fetchLimit,
      forceLatest: options.forceLatest
    });
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        connectionStatus: {
          lastSyncStatus: "COMPLETED",
          lastSyncStartedAt: startedAt.toISOString(),
          lastSyncCompletedAt: new Date().toISOString(),
          lastSyncMode: options.forceLatest ? "FORCE_LATEST" : "LATEST",
          lastSyncImported: inbox.imported,
          lastSyncSkipped: inbox.skipped,
          lastSyncNeedsReview: inbox.needsReview,
          lastSyncFolder: account.inboxFolder || "INBOX"
        }
      }
    });
    await logActivity({
      type: "MAIL_SYNC",
      message: `Synced lead intake: ${inbox.imported} leads, ${inbox.needsReview} need review`,
      metadata: { inbox, fetchLimit, account: account.emailAddress }
    });
    return {
      ...inbox,
      configured: true,
      account: account.emailAddress,
      folder: account.inboxFolder || "INBOX",
      forceLatest: Boolean(options.forceLatest),
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      steps: [
        "Connecting",
        "Checking latest emails",
        `Imported ${inbox.imported} new emails`,
        `Created ${inbox.imported} leads`,
        `Updated ${inbox.updated || 0} leads`,
        `Skipped ${inbox.skipped} duplicates`
      ]
    };
  } finally {
    await client.logout();
  }
}

export async function syncAllEmailWorkflows(limit?: number) {
  const accounts = await prisma.emailAccount.findMany({ where: { isActive: true }, orderBy: { emailAddress: "asc" } });
  const results = [];
  for (const account of accounts) {
    if (account.accountType === "LEAD_INTAKE") {
      results.push({
        account: account.emailAddress,
        mode: "lead-intake",
        result: await syncLeadIntakeEmails(limit).catch((error) => ({
          imported: 0,
          skipped: 0,
          needsReview: 0,
          configured: false,
          error: error instanceof Error ? error.message : String(error)
        }))
      });
    } else {
      results.push({
        account: account.emailAddress,
        mode: "sales",
        result: await syncEmailAccount(account.id, { batchSize: limit }).catch((error) => ({
          inbox: { imported: 0, skipped: 0 },
          sent: { imported: 0, skipped: 0 },
          error: error instanceof Error ? error.message : String(error)
        }))
      });
    }
  }
  return { accounts: results };
}

export async function syncInbox(limit = 50) {
  return syncEmails(limit);
}

export async function testImapConnection() {
  const account = await getActiveAccount();
  const { imapPassword } = accountSecrets(account);
  const client = createClient(account, imapPassword);
  await client.connect();
  await client.logout();
  return true;
}
