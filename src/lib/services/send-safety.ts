import type { EmailAccount, Lead } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SafetyInput = {
  account: EmailAccount;
  lead: Lead & { notes?: string | null };
  draftId?: string | null;
  threadId?: string | null;
  toEmails: string[];
  subject: string;
  body: string;
  bodyHtml?: string | null;
  scheduledAt?: Date | null;
  safetyConfirmed?: boolean;
  emailType?: EmailSafetyType;
};

export type EmailSafetyType =
  | "COLD_OUTREACH"
  | "FOLLOW_UP"
  | "REVIVAL"
  | "CONVERSATION_REPLY"
  | "TRANSACTIONAL_REPLY";

export type ContactBlockResult = {
  blocked: boolean;
  code: "DO_NOT_CONTACT" | "NOT_INTERESTED" | "BOUNCED" | "UNSUBSCRIBED" | "INVALID_EMAIL" | "SPAM_COMPLAINT" | null;
  label: string;
  reason: string;
  phrase?: string;
  sourceSubject?: string | null;
  sourceDate?: Date | null;
};

export type SendLimitConfig = {
  maxPerDay: number;
  maxPerHour: number;
  maxPerTenMinutes: number;
  warmupEnabled: boolean;
  randomDelayMinMinutes: number;
  randomDelayMaxMinutes: number;
};

export type SendSafetyDecision = {
  action: "ALLOW" | "QUEUE";
  reason?: string;
  nextSafeSendAt: Date;
  limits: SendLimitConfig;
  warmedDailyLimit: number;
  usage: { sentDay: number; sentHour: number; sentTenMinutes: number };
  warnings: Array<{ severity: "MEDIUM" | "HIGH"; message: string }>;
  spamRisk: "Low" | "Medium" | "High";
  emailType: EmailSafetyType;
  duplicateGuardBypassed: boolean;
};

const DEFAULT_LIMITS: SendLimitConfig = {
  maxPerDay: 50,
  maxPerHour: 10,
  maxPerTenMinutes: 3,
  warmupEnabled: false,
  randomDelayMinMinutes: 2,
  randomDelayMaxMinutes: 7
};

const DNC_PATTERNS = [
  { code: "UNSUBSCRIBED", label: "Unsubscribed", pattern: /unsubscribe/i },
  { code: "DO_NOT_CONTACT", label: "Do Not Contact", pattern: /\bstop\b/i },
  { code: "DO_NOT_CONTACT", label: "Do Not Contact", pattern: /remove me/i },
  { code: "NOT_INTERESTED", label: "Not Interested", pattern: /not interested/i },
  { code: "SPAM_COMPLAINT", label: "Spam Complaint", pattern: /spam complaint/i },
  { code: "DO_NOT_CONTACT", label: "Do Not Contact", pattern: /do not contact/i },
  { code: "DO_NOT_CONTACT", label: "Do Not Contact", pattern: /don't contact/i }
];

const BOUNCE_PATTERNS = [
  { code: "BOUNCED", label: "Bounced", pattern: /delivery (?:status )?notification/i },
  { code: "BOUNCED", label: "Bounced", pattern: /delivery failed/i },
  { code: "BOUNCED", label: "Bounced", pattern: /undeliver(?:ed|able)/i },
  { code: "BOUNCED", label: "Bounced", pattern: /mailbox full/i },
  { code: "INVALID_EMAIL", label: "Invalid Email", pattern: /invalid (?:recipient|email|address)/i },
  { code: "INVALID_EMAIL", label: "Invalid Email", pattern: /user unknown/i },
  { code: "BOUNCED", label: "Bounced", pattern: /message bounced/i }
];

const SPAM_WORDS = [
  "guaranteed",
  "risk free",
  "act now",
  "limited time",
  "free money",
  "100%",
  "urgent!!!",
  "winner"
];

export async function enforceSendSafety(input: SafetyInput) {
  const limits = resolveLimits(input.account);
  const warmedLimit = resolveWarmupLimit(input.account, limits.maxPerDay);
  const now = new Date();
  const [sentDay, sentHour, sentTenMinutes, lastOutbound, sameDraftSent, dncReason, emailType] = await Promise.all([
    countOutbound(input.account.emailAddress, startOfDay(now)),
    countOutbound(input.account.emailAddress, minutesAgo(60)),
    countOutbound(input.account.emailAddress, minutesAgo(10)),
    prisma.email.findFirst({
      where: {
        direction: "OUTBOUND",
        fromEmail: { equals: input.account.emailAddress, mode: "insensitive" },
        toEmails: { hasSome: input.toEmails },
        sentAt: { gte: minutesAgo(60 * 24) }
      },
      orderBy: { sentAt: "desc" }
    }),
    input.draftId
      ? prisma.sentEmail.findUnique({ where: { draftId: input.draftId } }).catch(() => null)
      : Promise.resolve(null),
    detectDoNotContactForLeadOrThread({ leadId: input.lead.id, threadId: input.threadId, emails: input.toEmails, notes: input.lead.notes }),
    resolveEmailSafetyType(input)
  ]);

  const criticalBlocks: string[] = [];
  if (!input.account.emailAddress) criticalBlocks.push("Missing from account.");
  if (!input.toEmails.length) criticalBlocks.push("Missing recipient.");
  if (!input.body.trim()) criticalBlocks.push("Missing body.");
  if (sameDraftSent) criticalBlocks.push("This draft has already been sent.");
  if (dncReason.blocked) criticalBlocks.push(dncReason.reason);
  if (criticalBlocks.length) throw new Error(`Send blocked: ${criticalBlocks.join(" ")}`);

  const warnings = buildSpamWarnings(input);
  if (warnings.some((warning) => warning.severity === "HIGH") && !input.safetyConfirmed) {
    throw new Error(`Spam safety warning: ${warnings.map((warning) => warning.message).join(" ")} Confirm send after review.`);
  }
  const softReasons: string[] = [];
  const softDates: Date[] = [];
  if (sentDay >= warmedLimit) {
    softReasons.push(`Daily send limit reached (${sentDay}/${warmedLimit}).`);
    softDates.push(nextDayStart());
  }
  if (sentHour >= limits.maxPerHour) {
    softReasons.push(`Hourly send limit reached (${sentHour}/${limits.maxPerHour}).`);
    softDates.push(minutesFromNow(60));
  }
  if (sentTenMinutes >= limits.maxPerTenMinutes) {
    softReasons.push(`10-minute send limit reached (${sentTenMinutes}/${limits.maxPerTenMinutes}).`);
    softDates.push(minutesFromNow(10));
  }
  const bypassDuplicateGuard = emailType === "CONVERSATION_REPLY" || emailType === "TRANSACTIONAL_REPLY";
  if (lastOutbound && !bypassDuplicateGuard) {
    softReasons.push("Recipient already received an email from this account in the last 24 hours.");
    softDates.push(new Date(lastOutbound.sentAt.getTime() + 24 * 60 * 60_000));
  }
  const randomDelayAt = await computeNextAllowedAt(input.account.emailAddress, limits);
  if (randomDelayAt.getTime() > Date.now()) {
    softReasons.push("Random send spacing is active.");
    softDates.push(randomDelayAt);
  }
  const nextSafeSendAt = latestDate([now, ...softDates]);

  return {
    action: softReasons.length ? "QUEUE" : "ALLOW",
    reason: softReasons.join(" "),
    limits,
    warmedDailyLimit: warmedLimit,
    usage: { sentDay, sentHour, sentTenMinutes },
    warnings,
    spamRisk: warnings.some((w) => w.severity === "HIGH") ? "High" : warnings.length ? "Medium" : "Low",
    nextSafeSendAt,
    emailType,
    duplicateGuardBypassed: bypassDuplicateGuard
  } satisfies SendSafetyDecision;
}

async function resolveEmailSafetyType(input: SafetyInput): Promise<EmailSafetyType> {
  if (input.emailType) return input.emailType;
  const draft = input.draftId
    ? await prisma.draft.findUnique({
        where: { id: input.draftId },
        select: {
          draftType: true,
          basedOnMessageId: true,
          sourceEmailId: true,
          basedOnEmailId: true,
          threadId: true
        }
      }).catch(() => null)
    : null;
  if (draft?.draftType === "FOLLOWUP") return "FOLLOW_UP";
  const threadId = input.threadId || draft?.threadId;
  if (!threadId) return "COLD_OUTREACH";
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      emails: {
        orderBy: { sentAt: "desc" },
        take: 20,
        select: { id: true, direction: true, messageId: true, inReplyTo: true, references: true, sentAt: true }
      },
      sentEmails: { orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } }
    }
  }).catch(() => null);
  if (!thread) return "COLD_OUTREACH";
  const latestInbound = thread.emails.find((email) => email.direction === "INBOUND");
  const latestOutbound = thread.emails.find((email) => email.direction === "OUTBOUND");
  const latestOurSent = thread.sentEmails[0];
  const lastOutboundAt = latestOutbound?.sentAt || latestOurSent?.sentAt || null;
  const clientRepliedAfterLastOutbound = Boolean(latestInbound && (!lastOutboundAt || latestInbound.sentAt > lastOutboundAt));
  const hasThreadReplyMarkers = Boolean(
    draft?.basedOnMessageId
    || draft?.basedOnEmailId
    || draft?.sourceEmailId
    || latestInbound?.messageId
    || thread.emails.some((email) => email.inReplyTo || email.references)
  );
  if (latestInbound && (clientRepliedAfterLastOutbound || hasThreadReplyMarkers)) return "CONVERSATION_REPLY";
  return "COLD_OUTREACH";
}

export async function getAccountSendHealth(accountEmail: string) {
  const account = await prisma.emailAccount.findFirst({
    where: { emailAddress: { equals: accountEmail, mode: "insensitive" } }
  });
  if (!account) throw new Error("Email account not found.");
  const limits = resolveLimits(account);
  const now = new Date();
  const [sentDay, sentHour, bounces, unsubscribes, failedSchedules] = await Promise.all([
    countOutbound(account.emailAddress, startOfDay(now)),
    countOutbound(account.emailAddress, minutesAgo(60)),
    prisma.email.count({
      where: {
        direction: "INBOUND",
        isBounce: true,
        sentAt: { gte: startOfDay(now) }
      }
    }),
    prisma.email.count({
      where: {
        direction: "INBOUND",
        textBody: { contains: "unsubscribe", mode: "insensitive" },
        sentAt: { gte: startOfDay(now) }
      }
    }),
    prisma.scheduledEmail.count({
      where: {
        fromEmail: { equals: account.emailAddress, mode: "insensitive" },
        status: "FAILED",
        updatedAt: { gte: startOfDay(now) }
      }
    })
  ]);
  const status = bounces >= 5 || failedSchedules >= 5 ? "Blocked" : sentHour >= limits.maxPerHour * 0.8 || sentDay >= limits.maxPerDay * 0.8 ? "Warning" : "Safe";
  return { accountEmail: account.emailAddress, sentDay, sentHour, bounces, unsubscribes, failedSchedules, status, limits };
}

function resolveLimits(account: EmailAccount): SendLimitConfig {
  const config = (account.schedulerConfig && typeof account.schedulerConfig === "object" && !Array.isArray(account.schedulerConfig))
    ? account.schedulerConfig as Record<string, unknown>
    : {};
  const deliverability = (config.deliverability && typeof config.deliverability === "object" && !Array.isArray(config.deliverability))
    ? config.deliverability as Record<string, unknown>
    : config;
  return {
    maxPerDay: numberValue(deliverability.maxPerDay, DEFAULT_LIMITS.maxPerDay),
    maxPerHour: numberValue(deliverability.maxPerHour, DEFAULT_LIMITS.maxPerHour),
    maxPerTenMinutes: numberValue(deliverability.maxPerTenMinutes, DEFAULT_LIMITS.maxPerTenMinutes),
    warmupEnabled: Boolean(deliverability.warmupEnabled ?? DEFAULT_LIMITS.warmupEnabled),
    randomDelayMinMinutes: numberValue(deliverability.randomDelayMinMinutes, DEFAULT_LIMITS.randomDelayMinMinutes),
    randomDelayMaxMinutes: numberValue(deliverability.randomDelayMaxMinutes, DEFAULT_LIMITS.randomDelayMaxMinutes)
  };
}

function resolveWarmupLimit(account: EmailAccount, configuredLimit: number) {
  const limits = resolveLimits(account);
  if (!limits.warmupEnabled) return configuredLimit;
  const ageDays = Math.max(1, Math.floor((Date.now() - account.createdAt.getTime()) / 86_400_000) + 1);
  if (ageDays === 1) return Math.min(configuredLimit, 10);
  if (ageDays === 2) return Math.min(configuredLimit, 15);
  if (ageDays === 3) return Math.min(configuredLimit, 20);
  return configuredLimit;
}

export async function detectDoNotContactForLeadOrThread(input: {
  leadId?: string | null;
  threadId?: string | null;
  emails?: string[];
  notes?: string | null;
}): Promise<ContactBlockResult> {
  const emails = (input.emails || []).map((email) => email.toLowerCase()).filter(Boolean);
  const or: Prisma.EmailWhereInput[] = [
    { fromEmail: { in: emails } },
    { toEmails: { hasSome: emails } }
  ];
  if (input.threadId) or.push({ threadId: input.threadId });
  if (input.leadId) or.push({ thread: { leadId: input.leadId } });
  const related = await prisma.email.findMany({
    where: {
      OR: or,
      sentAt: { gte: daysAgo(3650) }
    },
    orderBy: { sentAt: "desc" },
    take: 50
  });
  const sources = [
    { subject: "Lead notes", date: null as Date | null, text: input.notes || "" },
    ...related.map((email) => ({
      subject: email.subject,
      date: email.sentAt,
      text: `${email.subject}\n${email.textBody || ""}\n${email.snippet || ""}`,
      isBounce: email.isBounce
    }))
  ];
  for (const source of sources) {
    const dnc = DNC_PATTERNS.find((item) => item.pattern.test(source.text));
    if (dnc) {
      const result = buildBlockResult(dnc.code as ContactBlockResult["code"], dnc.label, dnc.pattern.source, source.subject, source.date);
      await persistLeadBlock(input.leadId, result);
      return result;
    }
    const bounce = BOUNCE_PATTERNS.find((item) => Boolean((source as { isBounce?: boolean }).isBounce) || item.pattern.test(source.text));
    if (bounce) {
      const result = buildBlockResult(bounce.code as ContactBlockResult["code"], bounce.label, bounce.pattern.source, source.subject, source.date);
      await persistLeadBlock(input.leadId, result);
      return result;
    }
  }
  return { blocked: false, code: null, label: "Safe to Contact", reason: "" };
}

export async function getLeadContactBlock(leadId: string): Promise<ContactBlockResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { threads: { select: { id: true } } }
  });
  if (!lead) return { blocked: false, code: null, label: "Safe to Contact", reason: "" };
  if (hasPersistedBlockMarker(lead.notes)) {
    return {
      blocked: true,
      code: blockCodeFromReason(lead.notes),
      label: labelFromReason(lead.notes),
      reason: "Lead is marked Do Not Contact.",
      sourceDate: undefined
    };
  }
  return detectDoNotContactForLeadOrThread({
    leadId: lead.id,
    emails: [lead.email],
    notes: lead.notes,
    threadId: lead.threads[0]?.id
  });
}

function buildBlockResult(code: ContactBlockResult["code"], label: string, phrase: string, sourceSubject?: string | null, sourceDate?: Date | null): ContactBlockResult {
  return {
    blocked: true,
    code,
    label,
    phrase,
    sourceSubject,
    sourceDate,
    reason: `${label} detected${sourceSubject ? ` in "${sourceSubject}"` : ""}.`
  };
}

async function persistLeadBlock(leadId: string | null | undefined, result: ContactBlockResult) {
  if (!leadId || !result.blocked) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { notes: true } }).catch(() => null);
  const marker = `[AUTO_BLOCK:${result.code || "DO_NOT_CONTACT"}] ${result.reason}`;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: "LOST",
      notes: { set: lead?.notes?.includes(marker) ? lead.notes : [lead?.notes, marker].filter(Boolean).join("\n") }
    }
  }).catch(() => undefined);
}

function hasPersistedBlockMarker(notes?: string | null) {
  return /\[AUTO_BLOCK:|do not contact|unsubscribe|stop emailing|remove me|not interested|delivery failed|bounce/i.test(notes || "");
}

function blockCodeFromReason(reason?: string | null): ContactBlockResult["code"] {
  const value = (reason || "").toLowerCase();
  if (value.includes("not interested")) return "NOT_INTERESTED";
  if (value.includes("unsubscribe")) return "UNSUBSCRIBED";
  if (value.includes("invalid")) return "INVALID_EMAIL";
  if (value.includes("bounce")) return "BOUNCED";
  if (value.includes("spam")) return "SPAM_COMPLAINT";
  return "DO_NOT_CONTACT";
}

function labelFromReason(reason?: string | null) {
  const code = blockCodeFromReason(reason);
  return code === "NOT_INTERESTED" ? "Not Interested"
    : code === "UNSUBSCRIBED" ? "Unsubscribed"
    : code === "INVALID_EMAIL" ? "Invalid Email"
    : code === "BOUNCED" ? "Bounced"
    : code === "SPAM_COMPLAINT" ? "Spam Complaint"
    : "Do Not Contact";
}

function buildSpamWarnings(input: SafetyInput) {
  const warnings: Array<{ severity: "MEDIUM" | "HIGH"; message: string }> = [];
  const text = `${input.subject}\n${input.body}`;
  const linkCount = (input.bodyHtml || input.body).match(/https?:\/\//gi)?.length || 0;
  const imageCount = (input.bodyHtml || "").match(/<img\b/gi)?.length || 0;
  if (linkCount > 4) warnings.push({ severity: "HIGH", message: "Too many links." });
  if (imageCount > 3) warnings.push({ severity: "MEDIUM", message: "Too many images." });
  if (input.subject.length > 8 && input.subject === input.subject.toUpperCase()) warnings.push({ severity: "HIGH", message: "Subject is all caps." });
  if (SPAM_WORDS.some((word) => text.toLowerCase().includes(word))) warnings.push({ severity: "MEDIUM", message: "Spam-like wording detected." });
  if (input.body.length > 3500) warnings.push({ severity: "MEDIUM", message: "Email is very long." });
  if (!input.body.includes(input.lead.name || "") && !input.body.toLowerCase().includes(input.lead.email.split("@")[0].toLowerCase())) {
    warnings.push({ severity: "MEDIUM", message: "No clear personalization detected." });
  }
  if (!/Abhay Kumar|AResourcePool/i.test(input.body)) warnings.push({ severity: "HIGH", message: "Missing sender signature." });
  return warnings;
}

export async function computeNextAllowedAt(accountEmail: string, limits: SendLimitConfig) {
  const recent = await prisma.email.findMany({
    where: {
      direction: "OUTBOUND",
      fromEmail: { equals: accountEmail, mode: "insensitive" },
      sentAt: { gte: minutesAgo(limits.randomDelayMaxMinutes + 1) }
    },
    orderBy: { sentAt: "desc" },
    take: 1
  });
  const last = recent[0]?.sentAt;
  if (!last) return new Date();
  const min = Math.min(limits.randomDelayMinMinutes, limits.randomDelayMaxMinutes);
  const max = Math.max(limits.randomDelayMinMinutes, limits.randomDelayMaxMinutes);
  const delayMinutes = min + Math.floor(Math.random() * (max - min + 1));
  return new Date(last.getTime() + delayMinutes * 60_000);
}

async function countOutbound(fromEmail: string, since: Date) {
  return prisma.email.count({
    where: {
      direction: "OUTBOUND",
      fromEmail: { equals: fromEmail, mode: "insensitive" },
      sentAt: { gte: since }
    }
  });
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

function nextDayStart() {
  const next = startOfDay(new Date());
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

function latestDate(values: Date[]) {
  return values.reduce((latest, value) => value.getTime() > latest.getTime() ? value : latest, values[0]);
}
