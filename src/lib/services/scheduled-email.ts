import { prisma } from "@/lib/prisma";
import { getSenderAccountForLead } from "@/lib/services/account";
import { logActivity } from "@/lib/services/activity";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { buildLeadIntelligence, formatLocalTime, localDateTimeToUtc } from "@/lib/services/lead-intelligence";
import { sendApprovedDraft } from "@/lib/services/smtp";
import { enforceSendSafety } from "@/lib/services/send-safety";

type ScheduleDraftInput = {
  draftId: string;
  toEmails: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  bodyText?: string;
  attachmentMetadata?: { id: string; name: string; size: number; type: string }[];
  trackingEnabled: boolean;
  scheduleType: "BEST" | "CUSTOM";
  customClientLocalTime?: string;
  fromEmail?: string;
  createdBy?: string;
  safetyConfirmed?: boolean;
};

export async function scheduleDraft(input: ScheduleDraftInput) {
  const draft = await prisma.draft.findUnique({
    where: { id: input.draftId },
    include: {
      thread: {
        include: {
          lead: {
            include: {
              threads: {
                include: {
                  emails: true,
                  sentEmails: { include: { engagement: true } }
                }
              }
            }
          }
        }
      }
    }
  });
  if (!draft) throw new Error("Draft not found");
  if (draft.status === "SENT") throw new Error("Draft has already been sent.");
  if (!draft.thread.lead) throw new Error("Draft is not linked to a lead.");
  if (draft.thread.lead.clientEmailConfidence !== null && draft.thread.lead.clientEmailConfidence < 80) {
    throw new Error("Client email confidence is below 80%. Confirm the client email before scheduling.");
  }
  if (!input.toEmails.length) throw new Error("Client email is required before scheduling.");
  if (!input.body.trim()) throw new Error("Draft body is required before scheduling.");

  const existingScheduled = await prisma.scheduledEmail.findFirst({
    where: {
      draftId: draft.id,
      status: { in: ["SCHEDULED", "QUEUED", "RETRY", "SENDING"] }
    }
  });
  if (existingScheduled) throw new Error("This draft is already scheduled.");

  const account = input.fromEmail
    ? await getSenderAccountByEmail(input.fromEmail)
    : await getSenderAccountForLead(draft.thread.lead);
  if (!account.emailAddress) throw new Error("Sender email is required before scheduling.");
  const intelligence = buildLeadIntelligence(draft.thread.lead);
  const scheduledAt = input.scheduleType === "BEST"
    ? new Date(intelligence.nextBestSendTimeIso)
    : localDateTimeToUtc(input.customClientLocalTime || "", intelligence.detectedTimezone);
  if (scheduledAt.getTime() <= Date.now()) throw new Error("Scheduled time must be in the future.");
  const safety = await enforceSendSafety({
    account,
    lead: draft.thread.lead,
    draftId: draft.id,
    threadId: draft.threadId,
    toEmails: input.toEmails,
    subject: input.subject,
    body: input.bodyText || input.body,
    bodyHtml: input.bodyHtml,
    scheduledAt,
    safetyConfirmed: input.safetyConfirmed,
    emailType: draft.draftType === "FOLLOWUP" ? "FOLLOW_UP" : undefined
  });
  const finalScheduledAt = safety.action === "QUEUE" && safety.nextSafeSendAt.getTime() > scheduledAt.getTime()
    ? safety.nextSafeSendAt
    : scheduledAt;
  const finalStatus = safety.action === "QUEUE" ? "QUEUED" : "SCHEDULED";
  const queueReason = safety.action === "QUEUE" ? `Adjusted to next safe send window. ${safety.reason || ""}`.trim() : null;

  const scheduled = await prisma.$transaction(async (tx) => {
    const item = await tx.scheduledEmail.create({
      data: {
        leadId: draft.thread.lead!.id,
        draftId: draft.id,
        fromEmail: account.emailAddress,
        toEmail: input.toEmails.join(","),
        cc: (input.ccEmails || []).join(",") || null,
        bcc: (input.bccEmails || []).join(",") || null,
        subject: input.subject,
        body: input.body,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText || input.body,
        attachmentMetadata: input.attachmentMetadata,
        scheduledAt: finalScheduledAt,
        clientTimezone: intelligence.detectedTimezone,
        clientLocalScheduledAt: formatLocalTime(finalScheduledAt, intelligence.detectedTimezone),
        status: finalStatus,
        trackingEnabled: input.trackingEnabled,
        createdBy: input.createdBy,
        failureReason: queueReason
      }
    });
    await tx.draft.update({
      where: { id: draft.id },
      data: {
        toEmails: input.toEmails,
        ccEmails: input.ccEmails || [],
        bccEmails: input.bccEmails || [],
        subject: input.subject,
        body: input.body,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText || input.body,
        attachmentMetadata: input.attachmentMetadata,
        trackingEnabled: input.trackingEnabled,
        status: "SCHEDULED",
        approvedAt: new Date()
      }
    });
    await tx.lead.update({
      where: { id: draft.thread.lead!.id },
      data: {
        lastRecommendedSendTime: finalScheduledAt,
        bestSendTime: finalScheduledAt,
        ...(draft.draftType === "FOLLOWUP"
          ? {
              followupState: FOLLOWUP_STATES.SCHEDULED,
              followupStateUpdatedAt: new Date(),
              followupDraftId: draft.id,
              followupScheduledEmailId: item.id
            }
          : {})
      }
    });
    return item;
  });

  await logActivity({
    type: "DRAFT_APPROVED",
    message: safety.action === "QUEUE"
      ? `Email queued and will send at next safe time: ${scheduled.clientLocalScheduledAt || scheduled.scheduledAt.toISOString()}`
      : `Email scheduled for ${scheduled.clientLocalScheduledAt || scheduled.scheduledAt.toISOString()}`,
    leadId: draft.thread.lead.id,
    threadId: draft.threadId,
    metadata: { draftId: draft.id, scheduledEmailId: scheduled.id, scheduledAt: scheduled.scheduledAt.toISOString(), safetyAction: safety.action, reason: safety.reason }
  });

  console.info("scheduled-email-created", {
    id: scheduled.id,
    fromEmail: scheduled.fromEmail,
    toEmail: scheduled.toEmail,
    scheduledAt: scheduled.scheduledAt.toISOString(),
    status: scheduled.status
  });

  return scheduled;
}

async function getSenderAccountByEmail(email: string) {
  const account = await prisma.emailAccount.findFirst({
    where: {
      isActive: true,
      emailAddress: { equals: email, mode: "insensitive" }
    }
  });
  if (!account) throw new Error(`Active sales account not found for ${email}.`);
  return account;
}

export async function processDueScheduledEmails() {
  const due = await prisma.scheduledEmail.findMany({
    where: {
      status: { in: ["SCHEDULED", "QUEUED"] },
      scheduledAt: { lte: new Date() }
    },
    orderBy: { scheduledAt: "asc" },
    take: 25
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of due) {
    try {
      if (item.draftId) {
        const existingSentEmail = await prisma.sentEmail.findUnique({ where: { draftId: item.draftId } });
        if (existingSentEmail) {
          skipped += 1;
          await prisma.scheduledEmail.update({
            where: { id: item.id },
            data: {
              status: "SENT",
              sentAt: existingSentEmail.sentAt,
              failureReason: "Skipped duplicate scheduled send. This draft was already sent."
            }
          });
          continue;
        }
      }
      await prisma.scheduledEmail.update({ where: { id: item.id }, data: { status: "SENDING", failureReason: null } });
      if (!item.draftId) throw new Error("Scheduled email has no draft.");
      const account = await getSenderAccountByEmail(item.fromEmail);
      const draft = await prisma.draft.findUnique({
        where: { id: item.draftId },
        include: { thread: { include: { lead: true } } }
      });
      if (!draft?.thread.lead) throw new Error("Scheduled email is not linked to a lead.");
      const safety = await enforceSendSafety({
        account,
        lead: draft.thread.lead,
        draftId: item.draftId,
        threadId: draft.threadId,
        toEmails: splitEmails(item.toEmail),
        subject: item.subject,
        body: item.bodyText || item.body,
        bodyHtml: item.bodyHtml,
        scheduledAt: item.scheduledAt,
        safetyConfirmed: true,
        emailType: draft.draftType === "FOLLOWUP" ? "FOLLOW_UP" : undefined
      });
      if (safety.action === "QUEUE") {
        skipped += 1;
        await prisma.scheduledEmail.update({
          where: { id: item.id },
          data: {
            status: "QUEUED",
            scheduledAt: safety.nextSafeSendAt,
            failureReason: safety.reason || "Still waiting for next safe send window."
          }
        });
        continue;
      }
      await sendApprovedDraft(item.draftId, {
        toEmails: splitEmails(item.toEmail),
        ccEmails: splitEmails(item.cc || ""),
        bccEmails: splitEmails(item.bcc || ""),
        subject: item.subject,
        body: item.body,
        bodyHtml: item.bodyHtml || undefined,
        bodyText: item.bodyText || item.body,
        attachmentMetadata: Array.isArray(item.attachmentMetadata)
          ? item.attachmentMetadata as { id: string; name: string; size: number; type: string }[]
          : undefined,
        trackingEnabled: item.trackingEnabled,
        fromEmail: item.fromEmail,
        safetyConfirmed: true
      });
      await prisma.scheduledEmail.update({
        where: { id: item.id },
        data: { status: "SENT", sentAt: new Date(), failureReason: null }
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.scheduledEmail.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : String(error)
        }
      });
      await logActivity({
        type: "ERROR",
        message: "Scheduled email failed",
        leadId: item.leadId,
        metadata: { scheduledEmailId: item.id, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  return { processed: due.length, sent, failed, skipped };
}

export async function sendScheduledEmailNow(id: string) {
  await prisma.scheduledEmail.update({
    where: { id },
    data: { scheduledAt: new Date(), status: "QUEUED", failureReason: null }
  });
  return processDueScheduledEmails();
}

function splitEmails(value: string) {
  return value.split(/[,\n;]/).map((email) => email.trim().toLowerCase()).filter(Boolean);
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
