import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { generateReplyDraft } from "@/lib/services/openai";

type Classification =
  | "CLIENT_REPLY"
  | "OUR_SENT_EMAIL"
  | "SPAM_MARKETING"
  | "BOUNCE"
  | "UNSUBSCRIBE"
  | "NOT_INTERESTED"
  | "AUTO_REPLY"
  | "INTERNAL_EMAIL";

const INTERNAL_DOMAIN = "aresourcepool.com";
const AUTOMATION_DRAFT_LIMIT = 5;

export async function getAutomationSettings() {
  await ensureAutomationSettingsTable().catch(() => null);
  const delegate = automationSettingDelegate();
  if (delegate) {
    try {
      return await delegate.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: {}
      });
    } catch {
      // Fall back to raw SQL for stale Prisma clients or partially applied migrations.
    }
  }
  return rawAutomationSettings();
}

export async function runSafeAutomationOnce() {
  const settings = await getAutomationSettings();
  if (!settings.autoClassifyEnabled && !settings.autoCreateReplyDrafts && !settings.autoCreateFollowupDrafts) {
    return { classified: 0, draftsCreated: 0, followupsCreated: 0, blocked: 0 };
  }

  let classified = 0;
  let draftsCreated = 0;
  let followupsCreated = 0;
  let blocked = 0;

  try {
    if (settings.autoClassifyEnabled) {
      const result = await classifyRecentThreads(settings.autoBlockDoNotContact);
      classified += result.classified;
      blocked += result.blocked;
    }

    if (settings.autoCreateReplyDrafts) {
      draftsCreated += await autoCreateReplyDrafts();
    }

    if (settings.autoCreateFollowupDrafts) {
      followupsCreated += await autoCreateFollowupDrafts(settings);
    }

    await automationSettingDelegate()?.update({
      where: { id: "default" },
      data: { lastRunAt: new Date(), lastError: null }
    }).catch(() => null);
    return { classified, draftsCreated, followupsCreated, blocked };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await automationSettingDelegate()?.update({
      where: { id: "default" },
      data: { lastRunAt: new Date(), lastError: message }
    }).catch(() => null);
    await logActivity({ type: "ERROR", message: "Safe automation failed", metadata: { error: message } });
    return { classified, draftsCreated, followupsCreated, blocked, error: message };
  }
}

async function classifyRecentThreads(autoBlock: boolean) {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const threads = await prisma.emailThread.findMany({
    where: {
      lastMessageAt: { gte: since },
      leadId: { not: null },
      emails: { some: {} }
    },
    include: {
      lead: true,
      emails: { orderBy: { sentAt: "desc" }, take: 4 }
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100
  });

  let classified = 0;
  let blocked = 0;
  for (const thread of threads) {
    if (!thread.lead) continue;
    const latest = thread.emails[0];
    if (!latest) continue;
    const classification = classifyEmail(latest);
    const update = statusUpdateForClassification(classification, autoBlock, thread.lead.notes);
    if (!update) continue;

    await prisma.lead.update({
      where: { id: thread.lead.id },
      data: update
    });
    classified += 1;
    if (classification === "BOUNCE" || classification === "UNSUBSCRIBE" || classification === "NOT_INTERESTED") blocked += 1;
    await logActivity({
      type: classification === "CLIENT_REPLY" ? "MAIL_SYNC" : "LEAD_STATUS_CHANGED",
      message: notificationMessage(classification, thread.lead.email),
      leadId: thread.lead.id,
      threadId: thread.id,
      metadata: { classification, emailId: latest.id, automation: true }
    });
  }
  return { classified, blocked };
}

async function autoCreateReplyDrafts() {
  const threads = await prisma.emailThread.findMany({
    where: {
      lead: {
        status: "REPLIED"
      },
      emails: { some: { direction: "INBOUND" } }
    },
    include: {
      lead: true,
      emails: { orderBy: { sentAt: "desc" }, take: 4 },
      drafts: { where: { status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] } }, orderBy: { createdAt: "desc" }, take: 3 }
    },
    orderBy: { lastMessageAt: "desc" },
    take: AUTOMATION_DRAFT_LIMIT
  });

  let created = 0;
  for (const thread of threads) {
    const latestInbound = thread.emails.find((email) => email.direction === "INBOUND");
    const latestEmail = thread.emails[0];
    if (!thread.lead || !latestInbound || latestEmail?.direction !== "INBOUND") continue;
    if (isBlockedLead(thread.lead) || classifyEmail(latestInbound) !== "CLIENT_REPLY") continue;
    const duplicate = thread.drafts.some((draft) => draft.basedOnEmailId === latestInbound.id || draft.sourceEmailId === latestInbound.id);
    if (duplicate) continue;
    await generateReplyDraft(thread.id, "REPLY");
    created += 1;
    await logActivity({
      type: "DRAFT_GENERATED",
      message: `AI draft ready for ${thread.lead.email}`,
      leadId: thread.lead.id,
      threadId: thread.id,
      metadata: { automation: true, emailId: latestInbound.id }
    });
  }
  return created;
}

async function autoCreateFollowupDrafts(settings: Awaited<ReturnType<typeof getAutomationSettings>>) {
  const leads = await prisma.lead.findMany({
    where: {
      status: { notIn: ["WON", "LOST", "ARCHIVED", "REJECTED"] },
      threads: { some: { emails: { some: { direction: "OUTBOUND" } } } }
    },
    include: {
      threads: {
        orderBy: { lastMessageAt: "desc" },
        include: {
          emails: { orderBy: { sentAt: "desc" }, take: 8 },
          drafts: { where: { status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] } }, take: 1 }
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: AUTOMATION_DRAFT_LIMIT
  });

  let created = 0;
  for (const lead of leads) {
    if (isBlockedLead(lead)) continue;
    const thread = lead.threads.find((item) => item.emails.some((email) => email.direction === "OUTBOUND"));
    if (!thread || thread.drafts.length) continue;
    const latestOutbound = thread.emails.find((email) => email.direction === "OUTBOUND");
    const latestInbound = thread.emails.find((email) => email.direction === "INBOUND");
    if (!latestOutbound) continue;
    if (latestInbound && latestInbound.sentAt > latestOutbound.sentAt) continue;
    const stage = Math.min(Math.max(lead.followupStage || 1, 1), 4);
    const dueDays = followupDaysForStage(stage, settings);
    const daysSinceSent = Math.floor((Date.now() - latestOutbound.sentAt.getTime()) / 86_400_000);
    if (daysSinceSent < dueDays) continue;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "FOLLOW_UP_NEEDED",
        followupStage: stage,
        followupState: FOLLOWUP_STATES.DUE,
        nextFollowUpAt: new Date()
      }
    });
    await generateReplyDraft(thread.id, "FOLLOWUP");
    created += 1;
    await logActivity({
      type: "DRAFT_GENERATED",
      message: `Follow-up draft ready for ${lead.email}`,
      leadId: lead.id,
      threadId: thread.id,
      metadata: { automation: true, followupStage: stage, daysSinceSent }
    });
  }
  return created;
}

function classifyEmail(email: any): Classification {
  const text = [email.subject, email.fromEmail, email.fromName, email.snippet, email.textBody].filter(Boolean).join("\n");
  const fromDomain = String(email.fromEmail || "").split("@")[1]?.toLowerCase() || "";
  if (fromDomain === INTERNAL_DOMAIN) return "INTERNAL_EMAIL";
  if (email.direction === "OUTBOUND") return "OUR_SENT_EMAIL";
  if (email.isBounce || /delivery failed|undeliverable|mailbox full|user unknown|mailer-daemon|bounce/i.test(text)) return "BOUNCE";
  if (/unsubscribe|stop emailing|remove me|do not contact|don't contact/i.test(text)) return "UNSUBSCRIBE";
  if (/not interested|no longer interested|not required|not needed/i.test(text)) return "NOT_INTERESTED";
  if (email.isAutoReply || /out of office|automatic reply|auto-reply|vacation responder/i.test(text)) return "AUTO_REPLY";
  if (/newsletter|promotion|facebook|amazon|friend suggestion|webinar|digest|noreply|no-reply|notification/i.test(text)) return "SPAM_MARKETING";
  return "CLIENT_REPLY";
}

function statusUpdateForClassification(classification: Classification, autoBlock: boolean, existingNotes?: string | null) {
  if (classification === "CLIENT_REPLY") {
    return { status: "REPLIED" as const, waitingForReply: false, lastInboundAt: new Date() };
  }
  if (classification === "OUR_SENT_EMAIL") {
    return { waitingForReply: true };
  }
  if (classification === "AUTO_REPLY") return { notes: appendMarker(existingNotes || null, "AUTO_REPLY") };
  if (classification === "SPAM_MARKETING") return { notes: appendMarker(existingNotes || null, "MARKETING_SPAM") };
  if (!autoBlock) return null;
  if (classification === "BOUNCE") {
    return { notes: appendMarker(existingNotes || null, "AUTO_BLOCK:BOUNCE"), status: "LOST" as const };
  }
  if (classification === "UNSUBSCRIBE") {
    return { notes: appendMarker(existingNotes || null, "AUTO_BLOCK:UNSUBSCRIBE"), status: "LOST" as const };
  }
  if (classification === "NOT_INTERESTED") {
    return { notes: appendMarker(existingNotes || null, "AUTO_BLOCK:NOT_INTERESTED"), status: "LOST" as const };
  }
  return null;
}

function notificationMessage(classification: Classification, email: string) {
  if (classification === "CLIENT_REPLY") return `Client replied: ${email}`;
  if (classification === "BOUNCE") return `Bounce detected: ${email}`;
  if (classification === "UNSUBSCRIBE" || classification === "NOT_INTERESTED") return `Do-not-contact signal detected: ${email}`;
  if (classification === "SPAM_MARKETING") return `Marketing/spam email classified for ${email}`;
  return `Email classified as ${classification}: ${email}`;
}

export function automationSettingDelegate() {
  return (prisma as any).automationSetting || null;
}

export async function saveAutomationSettingsRaw(input: Record<string, unknown>) {
  await ensureAutomationSettingsTable();
  await prisma.$executeRaw`
    INSERT INTO "automation_settings" (
      "id",
      "autoSyncEnabled",
      "autoClassifyEnabled",
      "autoCreateReplyDrafts",
      "autoCreateFollowupDrafts",
      "autoBlockDoNotContact",
      "autoSuggestSchedule",
      "followup1Days",
      "followup2Days",
      "followup3Days",
      "finalFollowupDays",
      "updatedAt"
    )
    VALUES (
      'default',
      ${Boolean(input.autoSyncEnabled)},
      ${Boolean(input.autoClassifyEnabled)},
      ${Boolean(input.autoCreateReplyDrafts)},
      ${Boolean(input.autoCreateFollowupDrafts)},
      ${Boolean(input.autoBlockDoNotContact)},
      ${Boolean(input.autoSuggestSchedule)},
      ${Number(input.followup1Days || 3)},
      ${Number(input.followup2Days || 7)},
      ${Number(input.followup3Days || 14)},
      ${Number(input.finalFollowupDays || 21)},
      NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "autoSyncEnabled" = EXCLUDED."autoSyncEnabled",
      "autoClassifyEnabled" = EXCLUDED."autoClassifyEnabled",
      "autoCreateReplyDrafts" = EXCLUDED."autoCreateReplyDrafts",
      "autoCreateFollowupDrafts" = EXCLUDED."autoCreateFollowupDrafts",
      "autoBlockDoNotContact" = EXCLUDED."autoBlockDoNotContact",
      "autoSuggestSchedule" = EXCLUDED."autoSuggestSchedule",
      "followup1Days" = EXCLUDED."followup1Days",
      "followup2Days" = EXCLUDED."followup2Days",
      "followup3Days" = EXCLUDED."followup3Days",
      "finalFollowupDays" = EXCLUDED."finalFollowupDays",
      "lastError" = NULL,
      "updatedAt" = NOW()
  `;
  return rawAutomationSettings();
}

async function ensureAutomationSettingsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "automation_settings" (
      "id" TEXT NOT NULL DEFAULT 'default',
      "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
      "autoClassifyEnabled" BOOLEAN NOT NULL DEFAULT true,
      "autoCreateReplyDrafts" BOOLEAN NOT NULL DEFAULT true,
      "autoCreateFollowupDrafts" BOOLEAN NOT NULL DEFAULT true,
      "autoBlockDoNotContact" BOOLEAN NOT NULL DEFAULT true,
      "autoSuggestSchedule" BOOLEAN NOT NULL DEFAULT true,
      "followup1Days" INTEGER NOT NULL DEFAULT 3,
      "followup2Days" INTEGER NOT NULL DEFAULT 7,
      "followup3Days" INTEGER NOT NULL DEFAULT 14,
      "finalFollowupDays" INTEGER NOT NULL DEFAULT 21,
      "lastRunAt" TIMESTAMP(3),
      "lastError" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
    )
  `);
}

async function rawAutomationSettings() {
  await prisma.$executeRaw`
    INSERT INTO "automation_settings" ("id", "updatedAt")
    VALUES ('default', NOW())
    ON CONFLICT ("id") DO UPDATE SET "updatedAt" = "automation_settings"."updatedAt"
  `;
  const rows = await prisma.$queryRaw<Array<any>>`SELECT * FROM "automation_settings" WHERE "id" = 'default' LIMIT 1`;
  return rows[0] || defaultAutomationSettings(null);
}

function defaultAutomationSettings(lastError: string | null = null) {
  return {
    id: "default",
    autoSyncEnabled: true,
    autoClassifyEnabled: true,
    autoCreateReplyDrafts: false,
    autoCreateFollowupDrafts: false,
    autoBlockDoNotContact: true,
    autoSuggestSchedule: true,
    followup1Days: 3,
    followup2Days: 7,
    followup3Days: 14,
    finalFollowupDays: 21,
    lastRunAt: null,
    lastError,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function followupDaysForStage(stage: number, settings: Awaited<ReturnType<typeof getAutomationSettings>>) {
  if (stage === 1) return settings.followup1Days;
  if (stage === 2) return settings.followup2Days;
  if (stage === 3) return settings.followup3Days;
  return settings.finalFollowupDays;
}

function isBlockedLead(lead: { notes?: string | null; status?: string | null }) {
  return Boolean(lead.status === "LOST" || /\[AUTO_BLOCK:|do not contact|unsubscribe|not interested|delivery failed|bounce/i.test(lead.notes || ""));
}

function appendMarker(notes: string | null, marker: string) {
  const tag = `[AUTO_CLASSIFICATION:${marker}]`;
  return notes?.includes(tag) ? notes : [notes, tag].filter(Boolean).join("\n");
}
