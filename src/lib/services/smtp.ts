import nodemailer from "nodemailer";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { accountSecrets, getAbhaySenderAccount, getSenderAccountForLead } from "@/lib/services/account";
import { logActivity } from "@/lib/services/activity";
import { buildTrackedHtmlFromHtml } from "@/lib/services/engagement";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { appendSentEmailToImap, markSentAppendFailed } from "@/lib/services/imap-sent-append";
import { normalizeSubject } from "@/lib/services/threading";
import { enforceSendSafety } from "@/lib/services/send-safety";

export async function testSmtpConnection() {
  const account = await getAbhaySenderAccount();
  const { smtpPassword } = accountSecrets(account);
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.smtpUser, pass: smtpPassword }
  });
  await transporter.verify();
  return true;
}

type SendApprovedDraftInput = {
  toEmails?: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  subject?: string;
  body?: string;
  bodyHtml?: string;
  bodyText?: string;
  attachmentMetadata?: { id: string; name: string; size: number; type: string }[];
  trackingEnabled?: boolean;
  fromEmail?: string;
  safetyConfirmed?: boolean;
};

export async function sendApprovedDraft(draftId: string, input: SendApprovedDraftInput = {}) {
  const existingSentEmail = await prisma.sentEmail.findUnique({ where: { draftId } });
  if (existingSentEmail) {
    const existingDraft = await prisma.draft.findUnique({ where: { id: draftId } });
    return {
      alreadySent: true,
      message: "This draft was already sent.",
      updatedDraft: existingDraft,
      sentEmail: existingSentEmail
    };
  }
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    include: {
      edits: { orderBy: { createdAt: "asc" } },
      thread: {
        include: {
          lead: { include: { leadIntakes: true } },
          emails: { orderBy: { sentAt: "desc" }, take: 20 },
          sentEmails: { orderBy: { sentAt: "desc" }, take: 1 }
        }
      }
    }
  });
  if (!draft) throw new Error("Draft not found");
  if (draft.status === "SENT") {
    const sentEmail = await prisma.sentEmail.findUnique({ where: { draftId: draft.id } });
    if (sentEmail) {
      return {
        alreadySent: true,
        message: "This draft was already sent.",
        updatedDraft: draft,
        sentEmail
      };
    }
    throw new Error("Draft has already been sent");
  }
  if (draft.status === "APPROVED") throw new Error("This draft is already being sent.");
  if (!draft.thread.lead?.email) throw new Error("Thread is not linked to a lead email");

  const account = input.fromEmail
    ? await getSenderAccountByEmail(input.fromEmail)
    : await getSenderAccountForLead(draft.thread.lead);
  const { smtpPassword } = accountSecrets(account);
  const toEmails = normalizeEmailList(input.toEmails?.length ? input.toEmails : draft.toEmails.length ? draft.toEmails : [draft.thread.lead.email]);
  const ccEmails = normalizeEmailList(input.ccEmails ?? draft.ccEmails);
  const bccEmails = normalizeEmailList(input.bccEmails ?? draft.bccEmails);
  const subject = sanitizeOutgoingSubject(input.subject || draft.subject);
  validateRecipients({
    toEmails,
    ccEmails,
    bccEmails,
    leadEmail: draft.thread.lead.email,
    leadGeneratorEmails: draft.thread.lead.leadIntakes?.map((item) => item.leadGeneratorEmail || item.fromEmail) || [],
    existingConversation: hasExistingConversation(draft)
  });

  const body = input.bodyText || input.body || draft.bodyText || draft.body;
  const composedHtml = input.bodyHtml || draft.bodyHtml;
  const signature = `\n\nBest regards,\nAbhay Kumar\nSales & Marketing Director\nAResourcePool`;
  const cleanReplyBody = sanitizeOutgoingReplyBody(body.includes("Abhay Kumar") ? body : `${body.trim()}${signature}`);
  const conversationQuote = hasCustomerConversationQuote(cleanReplyBody) ? "" : buildForwardedLeadCustomerConversationQuote(draft);
  const finalBody = conversationQuote ? `${cleanReplyBody}\n\n${conversationQuote}` : cleanReplyBody;
  const cleanHtml = composedHtml ? sanitizeOutgoingReplyHtml(composedHtml) : "";
  const finalHtml = conversationQuote
    ? `${cleanHtml || textToHtml(cleanReplyBody)}\n${textToHtml(conversationQuote)}`
    : cleanHtml || textToHtml(finalBody);
  const safety = await enforceSendSafety({
    account,
    lead: draft.thread.lead,
    draftId: draft.id,
    threadId: draft.threadId,
    toEmails,
    subject,
    body: finalBody,
    bodyHtml: finalHtml,
    safetyConfirmed: input.safetyConfirmed,
    emailType: draft.draftType === "FOLLOWUP" ? "FOLLOW_UP" : undefined
  });
  if (safety.action === "QUEUE") {
    const queued = await queueDraftForSafeSend({
      draft,
      accountEmail: account.emailAddress,
      toEmails,
      ccEmails,
      bccEmails,
      subject,
      body: finalBody,
      bodyHtml: finalHtml,
      bodyText: finalBody,
      attachmentMetadata: input.attachmentMetadata,
      trackingEnabled: input.trackingEnabled ?? draft.trackingEnabled,
      scheduledAt: safety.nextSafeSendAt,
      reason: safety.reason || "Queued for next safe send window."
    });
    return { queued: true, scheduledEmail: queued, message: "Email queued and will send at next safe time." };
  }
  const locked = await prisma.draft.updateMany({
    where: {
      id: draft.id,
      status: { in: ["DRAFT", "SCHEDULED"] }
    },
    data: { status: "APPROVED", approvedAt: new Date() }
  });
  if (!locked.count) {
    const sentEmail = await prisma.sentEmail.findUnique({ where: { draftId: draft.id } });
    if (sentEmail) {
      return {
        alreadySent: true,
        message: "This draft was already sent.",
        updatedDraft: await prisma.draft.findUnique({ where: { id: draft.id } }),
        sentEmail
      };
    }
    throw new Error("This draft is already being sent.");
  }
  const aiOriginalDraft = draft.edits[0]?.beforeBody || draft.body;
  const editDifference = describeEditDifference(aiOriginalDraft, finalBody);
  const engagementId = crypto.randomUUID();
  const trackingEnabled = input.trackingEnabled ?? draft.trackingEnabled;
  const htmlBody = trackingEnabled ? buildTrackedHtmlFromHtml(finalHtml, engagementId) : finalHtml;
  const sentAt = new Date();
  const messageId = `<${crypto.randomUUID()}@${account.emailAddress.split("@")[1] || "aresourcepool.com"}>`;
  const realThreadMessageIds = draft.thread.emails
    .map((email) => email.messageId)
    .filter((messageId) => messageId && !messageId.includes("@ai-sales-os.local"));
  const inReplyTo = realThreadMessageIds[0] || null;
  const references = [...realThreadMessageIds].reverse();
  const rawMime = await buildRawMimeMessage({
    fromName: account.fromName,
    fromEmail: account.emailAddress,
    toEmails,
    ccEmails,
    bccEmails,
    subject,
    text: finalBody,
    html: htmlBody,
    messageId,
    date: sentAt,
    inReplyTo,
    references
  });
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.smtpUser, pass: smtpPassword }
  });

  let info: Awaited<ReturnType<typeof transporter.sendMail>>;
  try {
    info = await transporter.sendMail({
      envelope: {
        from: account.emailAddress,
        to: [...toEmails, ...ccEmails, ...bccEmails]
      },
      raw: rawMime
    });
  } catch (error) {
    await prisma.draft.update({
      where: { id: draft.id },
      data: { status: draft.status }
    });
    throw error;
  }

  const sent = await prisma.$transaction(async (tx) => {
    const duplicateSentEmail = await tx.sentEmail.findUnique({ where: { draftId: draft.id } });
    if (duplicateSentEmail) {
      return { updatedDraft: draft, sentEmail: duplicateSentEmail };
    }
    if (finalBody !== draft.body || subject !== draft.subject) {
      await tx.draftEdit.create({
        data: {
          draftId: draft.id,
          beforeSubject: draft.subject,
          afterSubject: subject,
          beforeBody: draft.body,
          afterBody: finalBody,
          editSummary: summarizeEdit(draft.body, finalBody)
        }
      });
    }
    const updatedDraft = await tx.draft.update({
      where: { id: draft.id },
      data: {
        toEmails,
        ccEmails,
        bccEmails,
        subject,
        body: finalBody,
        bodyHtml: finalHtml,
        bodyText: finalBody,
        attachmentMetadata: input.attachmentMetadata,
        trackingEnabled,
        status: "SENT",
        approvedAt: sentAt,
        sentAt
      }
    });
    const sentEmail = await tx.sentEmail.create({
      data: {
        threadId: draft.threadId,
        draftId: draft.id,
        providerId: messageId,
        sentFolder: account.sentFolder || "Sent",
        appendStatus: "PENDING",
        rawMime,
        toEmails,
        ccEmails,
        bccEmails,
        subject,
        body: finalBody,
        bodyHtml: finalHtml,
        bodyText: finalBody
      }
    });
    if (trackingEnabled) {
      await tx.emailEngagement.create({
        data: {
          id: engagementId,
          sentEmailId: sentEmail.id,
          deliveryStatus: info.accepted?.length ? "ACCEPTED" : "SUBMITTED",
          deliveredAt: new Date(),
          engagementScore: 5,
          leadScore: "Cold"
        }
      });
    }
    await tx.email.create({
      data: {
        accountId: account.id,
        threadId: draft.threadId,
        direction: "OUTBOUND",
        folder: account.sentFolder || "Sent",
        sourceFolder: account.sentFolder || "Sent",
        sourceFolderPath: account.sentFolder || "Sent",
        sourceProviderName: null,
        messageId,
        fromName: account.fromName,
        fromEmail: account.emailAddress,
        toEmails,
        ccEmails,
        bccEmails,
        subject,
        normalizedSubject: normalizeSubject(subject),
        snippet: finalBody.replace(/\s+/g, " ").slice(0, 220),
        textBody: finalBody,
        htmlBody,
        sentAt
      }
    });
    await tx.approvedEmailExample.create({
      data: {
        emailType: draft.draftType,
        leadIndustry: extractLeadMetadata(draft.thread.lead?.notes, "industry"),
        clientCountry: extractLeadMetadata(draft.thread.lead?.notes, "country"),
        aiOriginalDraft,
        userFinalSentEmail: finalBody,
        editDifference
      }
    });
    const nextFollowUpAt = new Date();
    nextFollowUpAt.setDate(nextFollowUpAt.getDate() + (draft.draftType === "FOLLOWUP" ? 5 : 2));
    await tx.lead.update({
      where: { id: draft.thread.leadId! },
      data: {
        status: "CONTACTED",
        waitingForReply: true,
        lastContactedAt: sentAt,
        lastOutboundAt: sentAt,
        followupStage: draft.followupStage || draft.thread.lead!.followupStage,
        nextFollowUpAt,
        ...(draft.draftType === "FOLLOWUP"
          ? {
              followupState: FOLLOWUP_STATES.SENT_WAITING_REPLY,
              followupStateUpdatedAt: sentAt,
              followupDraftId: draft.id,
              followupScheduledEmailId: null
            }
          : {})
      }
    });
    await tx.emailThread.update({
      where: { id: draft.threadId },
      data: { messageCount: { increment: 1 }, lastMessageAt: new Date() }
    });
    return { updatedDraft, sentEmail };
  });

  try {
    await appendSentEmailToImap(sent.sentEmail.id);
  } catch (error) {
    const warning = await markSentAppendFailed(sent.sentEmail.id, error);
    await logActivity({
      type: "ERROR",
      message: "Email delivered successfully but could not be copied to Sent folder.",
      leadId: draft.thread.lead.id,
      threadId: draft.threadId,
      metadata: { draftId, sentEmailId: sent.sentEmail.id, error: warning }
    });
  }

  const finalSentEmail = await prisma.sentEmail.findUnique({ where: { id: sent.sentEmail.id } });

  await logActivity({
    type: "EMAIL_SENT",
    message: `Approved draft sent to ${toEmails.join(", ")}`,
    leadId: draft.thread.lead.id,
    threadId: draft.threadId,
    metadata: { draftId, providerId: info.messageId }
  });

  return { ...sent, sentEmail: finalSentEmail || sent.sentEmail };
}

async function queueDraftForSafeSend(input: {
  draft: {
    id: string;
    threadId: string;
    thread: { lead: { id: string } | null };
  };
  accountEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  body: string;
  bodyHtml?: string | null;
  bodyText: string;
  attachmentMetadata?: { id: string; name: string; size: number; type: string }[];
  trackingEnabled: boolean;
  scheduledAt: Date;
  reason: string;
}) {
  if (!input.draft.thread.lead) throw new Error("Draft is not linked to a lead.");
  const queued = await prisma.scheduledEmail.create({
    data: {
      leadId: input.draft.thread.lead.id,
      draftId: input.draft.id,
      fromEmail: input.accountEmail,
      toEmail: input.toEmails.join(","),
      cc: input.ccEmails.join(",") || null,
      bcc: input.bccEmails.join(",") || null,
      subject: input.subject,
      body: input.body,
      bodyHtml: input.bodyHtml || undefined,
      bodyText: input.bodyText,
      attachmentMetadata: input.attachmentMetadata,
      scheduledAt: input.scheduledAt,
      status: "QUEUED",
      trackingEnabled: input.trackingEnabled,
      failureReason: input.reason
    }
  });
  await prisma.draft.update({
    where: { id: input.draft.id },
    data: {
      toEmails: input.toEmails,
      ccEmails: input.ccEmails,
      bccEmails: input.bccEmails,
      subject: input.subject,
      body: input.body,
      bodyHtml: input.bodyHtml || undefined,
      bodyText: input.bodyText,
      attachmentMetadata: input.attachmentMetadata,
      trackingEnabled: input.trackingEnabled,
      status: "SCHEDULED",
      approvedAt: new Date()
    }
  });
  await logActivity({
    type: "DRAFT_APPROVED",
    message: `Email queued for next safe send time: ${input.scheduledAt.toISOString()}`,
    leadId: input.draft.thread.lead.id,
    threadId: input.draft.threadId,
    metadata: { draftId: input.draft.id, scheduledEmailId: queued.id, reason: input.reason }
  });
  return queued;
}

async function buildRawMimeMessage(input: {
  fromName: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  date: Date;
  inReplyTo?: string | null;
  references: string[];
}) {
  const streamTransport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix"
  } as any);
  const info = await streamTransport.sendMail({
    from: `"${input.fromName}" <${input.fromEmail}>`,
    to: input.toEmails,
    cc: input.ccEmails.length ? input.ccEmails : undefined,
    bcc: input.bccEmails.length ? input.bccEmails : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId,
    date: input.date,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references.length ? input.references : undefined
  });
  const message = (info as unknown as { message?: Buffer | string }).message;
  return Buffer.isBuffer(message) ? message.toString("utf8") : String(message || "");
}

async function getSenderAccountByEmail(email: string) {
  const account = await prisma.emailAccount.findFirst({
    where: {
      isActive: true,
      emailAddress: { equals: email, mode: "insensitive" }
    }
  });
  if (!account) throw new Error(`Sender account is not configured for ${email}.`);
  return account;
}

function normalizeEmailList(value: string[]) {
  return Array.from(new Set(value.map((email) => email.trim().toLowerCase()).filter(Boolean)));
}

function validateRecipients(input: {
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  leadEmail: string;
  leadGeneratorEmails: string[];
  existingConversation?: boolean;
}) {
  if (!input.toEmails.length) throw new Error("At least one To recipient is required.");
  if (input.existingConversation) return;
  const blocked = new Set([
    "lead@aresourcepool.com",
    "abhay@aresourcepool.com",
    "sandip@aresourcepool.com",
    ...input.leadGeneratorEmails.map((email) => email.toLowerCase())
  ]);
  const all = [...input.toEmails, ...input.ccEmails, ...input.bccEmails];
  for (const email of all) {
    const domain = email.split("@")[1] || "";
    if (domain === "aresourcepool.com" || blocked.has(email) || email.includes("no-reply") || email.includes("noreply")) {
      throw new Error(`Recipient ${email} is not allowed for client outreach.`);
    }
  }
}

function hasExistingConversation(draft: {
  sourceEmailId?: string | null;
  basedOnEmailId?: string | null;
  basedOnMessageId?: string | null;
  thread?: {
    messageCount?: number | null;
    emails?: unknown[];
    sentEmails?: unknown[];
  } | null;
}) {
  return Boolean(
    draft.sourceEmailId
    || draft.basedOnEmailId
    || draft.basedOnMessageId
    || (draft.thread?.messageCount || 0) > 0
    || (draft.thread?.emails?.length || 0) > 0
    || (draft.thread?.sentEmails?.length || 0) > 0
  );
}

function buildForwardedLeadCustomerConversationQuote(draft: {
  thread?: {
    lead?: {
      leadIntakes?: Array<{
        replyMode?: string | null;
        conversationType?: string | null;
        leadSourceType?: string | null;
        latestClientMessage?: string | null;
        originalClientMessage?: string | null;
        previousProviderMessages?: string | null;
        originalConversationText?: string | null;
        fullForwardedChain?: string | null;
      }>;
    } | null;
    emails?: Array<{
      direction?: string;
      textBody?: string | null;
      snippet?: string | null;
    }>;
  } | null;
}) {
  const intake = draft.thread?.lead?.leadIntakes?.find((item) =>
    item.replyMode === "continue_existing_conversation"
    || item.conversationType === "warm_reply"
    || item.leadSourceType === "forwarded_provider_lead"
  );
  if (!intake) return "";

  const latestClientReply = sanitizeConversationQuoteText(
    intake.latestClientMessage
    || intake.originalClientMessage
    || draft.thread?.emails?.find((email) => email.direction === "INBOUND")?.textBody
    || draft.thread?.emails?.find((email) => email.direction === "INBOUND")?.snippet
    || ""
  );
  const originalOutreach = sanitizeConversationQuoteText(
    intake.previousProviderMessages
    || intake.originalConversationText
    || intake.fullForwardedChain
    || ""
  );

  const parts = [
    latestClientReply ? `On previous message, client wrote:\n${quoteLikeEmailClient(latestClientReply)}` : "",
    originalOutreach ? `Earlier outreach:\n${quoteLikeEmailClient(originalOutreach)}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n").slice(0, 9000) : "";
}

function hasCustomerConversationQuote(value: string) {
  return /On previous message,\s*client wrote:/i.test(value) || /Earlier outreach:/i.test(value) || /---\s*Client Reply\s*---/i.test(value) || /---\s*Original Outreach\s*---/i.test(value);
}

function quoteLikeEmailClient(value: string) {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function sanitizeOutgoingSubject(value: string) {
  const clean = (value || "")
    .replace(/\b(FW|Fwd)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.toLowerCase().startsWith("re:") ? clean : `Re: ${clean}`;
}

function sanitizeOutgoingReplyBody(value: string) {
  return stripForbiddenForwardingContent(value).trim();
}

function sanitizeOutgoingReplyHtml(value: string) {
  return stripForbiddenForwardingContent(value).trim();
}

function sanitizeConversationQuoteText(value: string) {
  return stripForbiddenForwardingContent(value)
    .replace(/^\s*(from|date|subject|to|cc|bcc|reply-to)\s*:.*$/gim, "")
    .replace(/^>+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

function stripForbiddenForwardingContent(value: string) {
  return (value || "")
    .replace(/-{2,}\s*forwarded message\s*-{2,}/gi, "")
    .replace(/begin forwarded message:/gi, "")
    .replace(/\bFW:\s*/gi, "")
    .replace(/\bFwd:\s*/gi, "")
    .replace(/original message/gi, "")
    .replace(/\[FORWARDED_LEAD_CONTEXT:[\s\S]*?\]/g, "")
    .replace(/\[AI_SALES_ACTION_TYPE:[^\]]+\]/g, "")
    .replace(/^\s*(provider|provider sender|provider email|approval status|lead metadata|internal note|sandip action)\s*:.*$/gim, "");
}

function textToHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function summarizeEdit(before: string, after: string) {
  const beforeLength = before.length;
  const afterLength = after.length;
  if (afterLength < beforeLength * 0.75) return "User shortened the draft before sending.";
  if (afterLength > beforeLength * 1.25) return "User added more detail before sending.";
  return "User refined wording before sending.";
}

function describeEditDifference(before: string, after: string) {
  if (before.trim() === after.trim()) return "No user edits before sending.";
  return summarizeEdit(before, after);
}

function extractLeadMetadata(notes: string | null | undefined, key: "industry" | "country") {
  if (!notes) return null;
  const match = notes.match(new RegExp(`${key}\\s*:\\s*([^\\n,;]+)`, "i"));
  return match?.[1]?.trim() || null;
}
