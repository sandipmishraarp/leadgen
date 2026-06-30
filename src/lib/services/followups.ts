import { prisma } from "@/lib/prisma";
import { FOLLOWUP_STATES, nextStateForDueLead, type FollowupState } from "@/lib/services/followup-state";
import { emailWhereForMailbox, isLeadIntakeMailbox, threadWhereForMailbox, type MailboxContext } from "@/lib/services/mailbox-filter";
import { detectDoNotContactForLeadOrThread, type ContactBlockResult } from "@/lib/services/send-safety";

const INTERNAL_DOMAIN = "aresourcepool.com";
const BLOCKED_STATUSES = new Set(["REJECTED", "LOST", "ARCHIVED"]);

type OutboundCandidate = {
  id: string;
  source: "email" | "sentEmail";
  threadId: string;
  leadId: string | null;
  leadName: string | null;
  leadStatus: string | null;
  lead?: {
    id: string;
    name: string | null;
    email: string;
    company: string | null;
    website: string | null;
    service: string | null;
    clientEmailConfidence: number | null;
    status: string;
    createdAt: Date;
    communicationStatus: string | null;
    blockReason: string | null;
    blockedAt: Date | null;
  } | null;
  clientEmail: string;
  subject: string;
  body: string;
  sentAt: Date;
  engagementScore: number;
};

export type FollowupBucket = "AUTO_DRAFT_SAFE" | "NEEDS_HUMAN_ATTENTION" | "BLOCKED" | "COMPLETED";

export type FollowupItem = {
  id: string;
  source: "assigned_lead" | "sent_email" | "email";
  threadId: string;
  leadId: string | null;
  leadName: string | null;
  clientEmail: string;
  subject: string;
  preview: string;
  lastSentAt: Date;
  daysSinceSent: number;
  followupStage: string;
  suggestedNextFollowupAt: Date;
  overdueDays: number;
  engagementScore: number;
  state: FollowupState;
  bucket: FollowupBucket;
  bucketReason: string;
  recommendedAction: string;
  riskFlags: string[];
  dataQualityWarnings: string[];
  draftId?: string | null;
  scheduledEmailId?: string | null;
  contactBlock?: ContactBlockResult;
};

function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizeSubject(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/^(re|fw|fwd):\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExcludedEmail(email: string, accountEmail: string, excludedEmails: string[] = [], excludedDomains: string[] = []) {
  const value = normalizeEmail(email);
  if (!value || !value.includes("@")) return true;
  if (value === normalizeEmail(accountEmail)) return true;
  if (value.includes("no-reply") || value.includes("noreply") || value.includes("mailer-daemon")) return true;
  const domain = value.split("@").pop() || "";
  if (domain === INTERNAL_DOMAIN || domain.endsWith(`.${INTERNAL_DOMAIN}`)) return true;
  if (excludedEmails.map(normalizeEmail).includes(value)) return true;
  return excludedDomains.map(normalizeEmail).some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getFollowupTiming(sentAt: Date, now = new Date()) {
  const daysSinceSent = Math.max(0, Math.floor((now.getTime() - sentAt.getTime()) / 86_400_000));
  if (daysSinceSent >= 20) return { daysSinceSent, stage: "Final follow-up", nextAt: addDays(sentAt, 20) };
  if (daysSinceSent >= 10) return { daysSinceSent, stage: "Follow-up 3", nextAt: addDays(sentAt, 10) };
  if (daysSinceSent >= 5) return { daysSinceSent, stage: "Follow-up 2", nextAt: addDays(sentAt, 5) };
  return { daysSinceSent, stage: "Follow-up 1", nextAt: addDays(sentAt, 2) };
}

function daysBetweenCalendarDates(from: Date, to: Date) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function followupStagePriority(stage: string) {
  if (/final/i.test(stage)) return 4;
  if (/3/.test(stage)) return 3;
  if (/2/.test(stage)) return 2;
  return 1;
}

function candidateKey(candidate: OutboundCandidate) {
  return `${candidate.clientEmail}|${candidate.threadId || normalizeSubject(candidate.subject)}`;
}

function leadIsBlocked(candidate: OutboundCandidate) {
  if (candidate.leadStatus && BLOCKED_STATUSES.has(candidate.leadStatus)) return true;
  return false;
}

const IMPORTANT_KEYWORDS = /\b(price|cost|proposal|quote|budget|timeline|call|meeting|interested|invoice|payment|contract)\b/i;

function isRevivalAge(createdAt?: Date | null) {
  if (!createdAt) return false;
  return Math.floor((Date.now() - createdAt.getTime()) / 86_400_000) >= 731;
}

function classifyFollowupItem(input: {
  candidate: OutboundCandidate;
  state: FollowupState;
  draft?: { id: string; status: string; createdAt: Date } | null;
  scheduled?: { id: string } | null;
  contactBlock?: ContactBlockResult;
  hasReplyAfterLatestOutbound: boolean;
  hasAttachments: boolean;
  inboundKeywordHit: boolean;
  outboundKeywordHit: boolean;
  duplicateConversationCount: number;
  overdueDays: number;
}) {
  const riskFlags: string[] = [];
  const dataQualityWarnings: string[] = [];
  const lead = input.candidate.lead;

  if (input.contactBlock?.blocked || lead?.communicationStatus === "DO_NOT_CONTACT" || lead?.blockedAt) {
    return {
      bucket: "BLOCKED" as const,
      bucketReason: input.contactBlock?.reason || lead?.blockReason || "Do-not-contact or blocked signal detected.",
      recommendedAction: "Archive or mark lost",
      riskFlags: [input.contactBlock?.label || lead?.blockReason || "Blocked"],
      dataQualityWarnings
    };
  }

  if (input.state !== FOLLOWUP_STATES.DUE) {
    return {
      bucket: "COMPLETED" as const,
      bucketReason: "This follow-up is already drafted, scheduled, sent, replied, or completed.",
      recommendedAction: "Review current state",
      riskFlags,
      dataQualityWarnings
    };
  }

  if (input.hasReplyAfterLatestOutbound) riskFlags.push("Recent client reply");
  if (!input.candidate.clientEmail || !input.candidate.clientEmail.includes("@")) riskFlags.push("Missing/invalid client email");
  if (lead?.clientEmailConfidence != null && lead.clientEmailConfidence < 70) riskFlags.push("Low email confidence below 70");
  if (!lead?.name) dataQualityWarnings.push("Missing name");
  if (!lead?.company) dataQualityWarnings.push("Missing company");
  if (!lead?.website) dataQualityWarnings.push("Missing website");
  if (!lead?.service) dataQualityWarnings.push("Missing service");
  if (input.inboundKeywordHit || input.outboundKeywordHit || IMPORTANT_KEYWORDS.test(input.candidate.subject) || IMPORTANT_KEYWORDS.test(input.candidate.body)) riskFlags.push("Important commercial keywords");
  if ((lead?.status || "").includes("REVIVAL") || isRevivalAge(lead?.createdAt)) riskFlags.push("Old/revival lead");
  if (input.candidate.engagementScore >= 50) riskFlags.push("High potential lead");
  if (input.hasAttachments) riskFlags.push("Conversation has attachments");
  if (input.duplicateConversationCount > 1) riskFlags.push("Possible duplicate");
  if (input.candidate.leadStatus && ["WON", "LOST", "ARCHIVED", "REJECTED"].includes(input.candidate.leadStatus)) riskFlags.push("Terminal lead status");
  if (input.candidate.leadStatus === "HOLD") riskFlags.push("Lead on hold");
  if (/final/i.test(getFollowupTiming(input.candidate.sentAt).stage) && input.overdueDays > 10) riskFlags.push("Final follow-up overdue 10+ days");

  if (riskFlags.length) {
    return {
      bucket: "NEEDS_HUMAN_ATTENTION" as const,
      bucketReason: riskFlags[0],
      recommendedAction: "Open lead and review manually",
      riskFlags,
      dataQualityWarnings
    };
  }

  return {
    bucket: "AUTO_DRAFT_SAFE" as const,
    bucketReason: "Safe contact, normal follow-up stage, no draft or schedule exists.",
    recommendedAction: "Generate follow-up draft",
    riskFlags,
    dataQualityWarnings
  };
}

export async function getSalesFollowupsForMailbox(mailbox: MailboxContext, state: FollowupState | FollowupState[] = FOLLOWUP_STATES.DUE): Promise<FollowupItem[]> {
  if (isLeadIntakeMailbox(mailbox)) return [];

  const account = mailbox.accountId
    ? await prisma.emailAccount.findUnique({ where: { id: mailbox.accountId } })
    : await prisma.emailAccount.findFirst({ where: { emailAddress: { equals: mailbox.email, mode: "insensitive" } } });

  const excludedEmails = account?.excludedEmails || [];
  const excludedDomains = account?.excludedDomains || [];
  const accountEmail = account?.emailAddress || mailbox.email;

  const [outboundEmails, sentEmails] = await Promise.all([
    prisma.email.findMany({
      where: {
        AND: [
          emailWhereForMailbox(mailbox),
          { direction: "OUTBOUND" },
          { isAutoReply: false },
          { isBounce: false },
          {
            OR: [
              { fromEmail: { equals: accountEmail, mode: "insensitive" } },
              { account: { emailAddress: { equals: accountEmail, mode: "insensitive" } } }
            ]
          }
        ]
      },
      orderBy: { sentAt: "desc" },
      take: 1500,
      include: {
        thread: { include: { lead: true } }
      }
    }),
    prisma.sentEmail.findMany({
      where: { thread: threadWhereForMailbox(mailbox) },
      orderBy: { sentAt: "desc" },
      take: 1500,
      include: {
        engagement: true,
        thread: { include: { lead: true } }
      }
    })
  ]);

  const candidates: OutboundCandidate[] = [];

  for (const email of outboundEmails) {
    for (const recipient of email.toEmails) {
      const clientEmail = normalizeEmail(recipient);
      if (isExcludedEmail(clientEmail, accountEmail, excludedEmails, excludedDomains)) continue;
      candidates.push({
        id: email.id,
        source: "email",
        threadId: email.threadId,
        leadId: email.thread.leadId || null,
        leadName: email.thread.lead?.name || null,
        leadStatus: email.thread.lead?.status || null,
        lead: email.thread.lead || null,
        clientEmail,
        subject: email.subject,
        body: email.textBody || email.snippet || "",
        sentAt: email.sentAt,
        engagementScore: 0
      });
    }
  }

  for (const sentEmail of sentEmails) {
    for (const recipient of sentEmail.toEmails) {
      const clientEmail = normalizeEmail(recipient);
      if (isExcludedEmail(clientEmail, accountEmail, excludedEmails, excludedDomains)) continue;
      candidates.push({
        id: sentEmail.id,
        source: "sentEmail",
        threadId: sentEmail.threadId,
        leadId: sentEmail.thread.leadId || null,
        leadName: sentEmail.thread.lead?.name || null,
        leadStatus: sentEmail.thread.lead?.status || null,
        lead: sentEmail.thread.lead || null,
        clientEmail,
        subject: sentEmail.subject,
        body: sentEmail.bodyText || sentEmail.body || "",
        sentAt: sentEmail.sentAt,
        engagementScore: sentEmail.engagement?.engagementScore || 0
      });
    }
  }

  if (!candidates.length) return [];

  const clientEmails = Array.from(new Set(candidates.map((candidate) => candidate.clientEmail)));
  const leadMatches = await prisma.lead.findMany({
    where: { email: { in: clientEmails } },
    select: { id: true, email: true, name: true, company: true, website: true, service: true, clientEmailConfidence: true, status: true, createdAt: true, communicationStatus: true, blockReason: true, blockedAt: true }
  });
  const leadsByEmail = new Map(leadMatches.map((lead) => [normalizeEmail(lead.email), lead]));

  for (const candidate of candidates) {
    const lead = leadsByEmail.get(candidate.clientEmail);
    if (!candidate.leadId && lead) candidate.leadId = lead.id;
    if (!candidate.leadName && lead?.name) candidate.leadName = lead.name;
    if (!candidate.leadStatus && lead?.status) candidate.leadStatus = lead.status;
    if (!candidate.lead && lead) candidate.lead = lead;
  }

  const latestByConversation = new Map<string, OutboundCandidate>();
  for (const candidate of candidates) {
    if (leadIsBlocked(candidate)) continue;
    const key = candidateKey(candidate);
    const existing = latestByConversation.get(key);
    if (!existing || candidate.sentAt > existing.sentAt) {
      latestByConversation.set(key, candidate);
    }
  }

  const latestCandidates = Array.from(latestByConversation.values());
  if (!latestCandidates.length) return [];

  const threadIds = Array.from(new Set(latestCandidates.map((candidate) => candidate.threadId)));
  const leadIds = Array.from(new Set(latestCandidates.map((candidate) => candidate.leadId).filter((id): id is string => Boolean(id))));
  const oldestSentAt = latestCandidates.reduce((oldest, candidate) => (candidate.sentAt < oldest ? candidate.sentAt : oldest), latestCandidates[0].sentAt);

  const [inboundReplies, followupDrafts, scheduledEmails, leadStates, threadSignals] = await Promise.all([
    prisma.email.findMany({
      where: {
        AND: [
          emailWhereForMailbox(mailbox),
          { direction: "INBOUND" },
          { sentAt: { gt: oldestSentAt } },
          { isAutoReply: false },
          { isBounce: false },
          {
            OR: [
              { threadId: { in: threadIds } },
              { fromEmail: { in: clientEmails } }
            ]
          }
        ]
      },
      select: { threadId: true, fromEmail: true, sentAt: true, subject: true, snippet: true, textBody: true, attachmentMetadata: true }
    }),
    prisma.draft.findMany({
      where: {
        threadId: { in: threadIds },
        draftType: "FOLLOWUP",
        isCurrent: true,
        status: { in: ["DRAFT", "APPROVED"] }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, threadId: true, status: true, createdAt: true }
    }),
    prisma.scheduledEmail.findMany({
      where: {
        leadId: { in: leadIds },
        status: { in: ["SCHEDULED", "QUEUED"] }
      },
      orderBy: { scheduledAt: "desc" },
      select: { id: true, leadId: true, draftId: true }
    }),
    prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, followupState: true, nextFollowUpAt: true, status: true }
    }),
    prisma.email.findMany({
      where: { threadId: { in: threadIds } },
      select: { threadId: true, direction: true, subject: true, snippet: true, textBody: true, attachmentMetadata: true }
    })
  ]);

  const now = new Date();
  const draftByThread = new Map(followupDrafts.map((draft) => [draft.threadId, draft]));
  const scheduledByLead = new Map(scheduledEmails.map((item) => [item.leadId, item]));
  const leadById = new Map(leadStates.map((lead) => [lead.id, lead]));
  const signalsByThread = new Map<string, typeof threadSignals>();
  for (const signal of threadSignals) {
    signalsByThread.set(signal.threadId, [...(signalsByThread.get(signal.threadId) || []), signal]);
  }
  const conversationCounts = new Map<string, number>();
  for (const candidate of latestCandidates) {
    const key = normalizeEmail(candidate.clientEmail);
    conversationCounts.set(key, (conversationCounts.get(key) || 0) + 1);
  }
  const items: FollowupItem[] = [];

  for (const candidate of latestCandidates) {
    const hasReplyAfterLatestOutbound = inboundReplies.some((reply) => {
        const replyFrom = normalizeEmail(reply.fromEmail);
        if (isExcludedEmail(replyFrom, accountEmail, excludedEmails, excludedDomains)) return false;
        return reply.sentAt > candidate.sentAt && (reply.threadId === candidate.threadId || replyFrom === candidate.clientEmail);
      });
    const timing = getFollowupTiming(candidate.sentAt, now);
    const lead = candidate.leadId ? leadById.get(candidate.leadId) : null;
    const draft = draftByThread.get(candidate.threadId);
    const scheduled = candidate.leadId ? scheduledByLead.get(candidate.leadId) : null;
    const terminal = lead?.status ? BLOCKED_STATUSES.has(lead.status) || ["WON", "LOST"].includes(lead.status) : false;
    const effectiveNextFollowupAt = lead?.nextFollowUpAt || timing.nextAt;
    const nextState = nextStateForDueLead({
      currentState: lead?.followupState,
      hasDraft: Boolean(draft),
      hasScheduled: Boolean(scheduled),
      hasReplyAfterLatestOutbound,
      isDue: effectiveNextFollowupAt <= now,
      isTerminal: terminal
    });
    if (!nextState) continue;

    if (candidate.leadId && lead?.followupState !== nextState) {
      await prisma.lead.update({
        where: { id: candidate.leadId },
        data: {
          followupState: nextState,
          followupStateUpdatedAt: now,
          followupDraftId: draft?.id || (nextState === FOLLOWUP_STATES.DUE ? null : undefined),
          followupScheduledEmailId: scheduled?.id || (nextState === FOLLOWUP_STATES.DUE ? null : undefined),
          nextFollowUpAt: effectiveNextFollowupAt,
          ...(nextState === FOLLOWUP_STATES.DUE ? { status: "FOLLOW_UP_NEEDED" as const, waitingForReply: true } : {})
        }
      });
    }

    const allowedStates = Array.isArray(state) ? state : [state];
    if (!allowedStates.includes(nextState)) continue;
    const overdueDays = daysBetweenCalendarDates(effectiveNextFollowupAt, now);
    if (nextState === FOLLOWUP_STATES.DUE && overdueDays < 0) continue;
    const threadSignalRows = signalsByThread.get(candidate.threadId) || [];
    const hasAttachments = threadSignalRows.some((signal) => Array.isArray(signal.attachmentMetadata) ? signal.attachmentMetadata.length > 0 : Boolean(signal.attachmentMetadata));
    const inboundKeywordHit = inboundReplies.some((reply) =>
      reply.threadId === candidate.threadId && IMPORTANT_KEYWORDS.test(`${reply.subject || ""} ${reply.snippet || ""} ${reply.textBody || ""}`)
    );
    const outboundKeywordHit = threadSignalRows.some((signal) =>
      signal.direction === "OUTBOUND" && IMPORTANT_KEYWORDS.test(`${signal.subject || ""} ${signal.snippet || ""} ${signal.textBody || ""}`)
    );
    const contactBlock = await detectDoNotContactForLeadOrThread({
      leadId: candidate.leadId,
      threadId: candidate.threadId,
      emails: [candidate.clientEmail]
    });
    const bucket = classifyFollowupItem({
      candidate,
      state: nextState,
      draft,
      scheduled,
      contactBlock,
      hasReplyAfterLatestOutbound,
      hasAttachments,
      inboundKeywordHit,
      outboundKeywordHit,
      duplicateConversationCount: conversationCounts.get(normalizeEmail(candidate.clientEmail)) || 1,
      overdueDays
    });
    const source: FollowupItem["source"] = candidate.leadId ? "assigned_lead" : candidate.source === "sentEmail" ? "sent_email" : "email";
    items.push({
      id: `${candidate.source}:${candidate.id}:${candidate.clientEmail}`,
      source,
      threadId: candidate.threadId,
      leadId: candidate.leadId,
      leadName: candidate.leadName,
      clientEmail: candidate.clientEmail,
      subject: candidate.subject,
      preview: candidate.body.replace(/\s+/g, " ").slice(0, 160),
      lastSentAt: candidate.sentAt,
      daysSinceSent: timing.daysSinceSent,
      followupStage: timing.stage,
      suggestedNextFollowupAt: effectiveNextFollowupAt,
      overdueDays,
      engagementScore: candidate.engagementScore,
      state: nextState,
      bucket: bucket.bucket,
      bucketReason: bucket.bucketReason,
      recommendedAction: bucket.recommendedAction,
      riskFlags: bucket.riskFlags,
      dataQualityWarnings: bucket.dataQualityWarnings,
      draftId: draft?.id,
      scheduledEmailId: scheduled?.id,
      contactBlock
    });
  }

  return items.sort((a, b) => {
    if (a.state === FOLLOWUP_STATES.DUE || b.state === FOLLOWUP_STATES.DUE) {
      return (
        b.overdueDays - a.overdueDays ||
        b.daysSinceSent - a.daysSinceSent ||
        followupStagePriority(b.followupStage) - followupStagePriority(a.followupStage) ||
        b.engagementScore - a.engagementScore ||
        a.lastSentAt.getTime() - b.lastSentAt.getTime()
      );
    }
    return a.suggestedNextFollowupAt.getTime() - b.suggestedNextFollowupAt.getTime() || b.lastSentAt.getTime() - a.lastSentAt.getTime();
  });
}
