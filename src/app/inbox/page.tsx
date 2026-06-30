import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { InboxClient } from "@/components/InboxClient";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveMailboxContext, threadWhereForMailbox } from "@/lib/services/mailbox-filter";

type InboxTab =
  | "all"
  | "unread"
  | "client-replies"
  | "needs-reply"
  | "follow-up-needed"
  | "draft-ready"
  | "scheduled"
  | "safe"
  | "blocked"
  | "spam";

const validTabs: InboxTab[] = ["all", "unread", "client-replies", "needs-reply", "follow-up-needed", "draft-ready", "scheduled", "safe", "blocked", "spam"];

const spamPatterns = [
  /amazon/i,
  /facebook/i,
  /friend suggestion/i,
  /newsletter/i,
  /unsubscribe/i,
  /promotion/i,
  /deal of the day/i,
  /limited time/i,
  /webinar/i,
  /digest/i,
  /notification/i,
  /noreply|no-reply/i
];

export default async function InboxPage({ searchParams }: { searchParams?: { mailbox?: string; tab?: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = await resolveMailboxContext(searchParams?.mailbox, "abhay@aresourcepool.com");
  const activeTab = (validTabs.includes(searchParams?.tab as InboxTab) ? searchParams?.tab : "needs-reply") as InboxTab;
  const rawThreads = await prisma.emailThread.findMany({
    where: { AND: [threadWhereForMailbox(mailbox), { emails: { some: { direction: "INBOUND" } } }] },
    orderBy: { lastMessageAt: "desc" },
    include: {
      account: { select: { emailAddress: true } },
      lead: {
        include: {
          scheduledEmails: {
            where: { status: { in: ["SCHEDULED", "QUEUED", "RETRY", "FAILED"] } },
            orderBy: { scheduledAt: "asc" },
            take: 1
          }
        }
      },
      emails: { orderBy: { sentAt: "desc" }, take: 8, select: inboxEmailListSelect() },
      drafts: { where: { status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      sentEmails: { orderBy: { sentAt: "desc" }, take: 1, select: { id: true, sentAt: true } }
    },
    take: 300
  });

  const rows = rawThreads.map((thread) => buildInboxRow(thread));
  const summary = {
    unread: rows.filter((row) => row.unread && row.latestDirection === "CLIENT REPLIED" && !row.isSpam && !row.isBlocked).length,
    needsReply: rows.filter((row) => row.needsReply).length,
    followups: rows.filter((row) => row.status === "Follow-up Needed").length,
    drafts: rows.filter((row) => row.status === "Draft Ready").length,
    blocked: rows.filter((row) => row.isBlocked).length,
    spam: rows.filter((row) => row.isSpam).length
  };

  return (
    <AppShell>
      <InboxClient rows={rows} summary={summary} mailbox={mailbox} activeTab={activeTab} />
    </AppShell>
  );
}

function buildInboxRow(thread: any) {
  const emails = Array.isArray(thread.emails) ? thread.emails : [];
  const latestEmail = emails[0];
  const latestInbound = emails.find((email: any) => email.direction === "INBOUND");
  const latestOutbound = emails.find((email: any) => email.direction === "OUTBOUND");
  const latestInboundAt = latestInbound?.sentAt || thread.lead?.lastInboundAt || null;
  const latestOutboundAt = latestOutbound?.sentAt || thread.sentEmails?.[0]?.sentAt || thread.lead?.lastOutboundAt || null;
  const hasDraft = Boolean(thread.drafts?.[0]);
  const scheduled = thread.lead?.scheduledEmails?.[0];
  const isBlocked = Boolean(hasBlockedMarker(thread.lead?.notes) || thread.lead?.status === "LOST");
  const isSpam = detectSpamMarketing(thread, latestEmail);
  const latestDirection = isSpam ? "SYSTEM/SPAM" : latestEmail?.direction === "OUTBOUND" ? "OUR LAST EMAIL" : "CLIENT REPLIED";
  const unread = Boolean(latestInboundAt && latestEmail?.direction === "INBOUND");
  const followupNeeded = thread.lead?.status === "FOLLOW_UP_NEEDED" || thread.lead?.followupState === "FOLLOWUP_DUE" || thread.lead?.waitingForReply;
  const status = isBlocked
    ? "Do Not Contact"
    : isSpam
    ? "Spam/Marketing"
    : scheduled
    ? "Scheduled"
    : hasDraft
    ? "Draft Ready"
    : unread && latestDirection === "CLIENT REPLIED"
    ? "Unread"
    : latestDirection === "CLIENT REPLIED"
    ? "Replied"
    : followupNeeded
    ? "Follow-up Needed"
    : "Waiting Reply";
  const nextAction = nextActionForStatus(status, latestDirection);
  return {
    id: thread.id,
    subject: thread.subject,
    clientName: thread.lead?.name || latestInbound?.fromName || thread.lead?.company || thread.lead?.email || latestInbound?.fromEmail || "Unknown client",
    clientEmail: thread.lead?.email || latestInbound?.fromEmail || latestEmail?.fromEmail || "No email",
    preview: latestEmail?.snippet || latestEmail?.textBody?.slice(0, 180) || "No preview available.",
    latestDirection,
    latestAt: toIso(latestEmail?.sentAt || thread.lastMessageAt),
    lastInboundAt: toIso(latestInboundAt),
    lastOutboundAt: toIso(latestOutboundAt),
    daysSinceReply: latestInboundAt ? Math.max(0, Math.floor((Date.now() - new Date(latestInboundAt).getTime()) / 86_400_000)) : null,
    unread,
    status,
    nextAction: nextAction.label,
    actionClass: nextAction.className,
    owner: thread.lead?.assignedUser || "Unassigned",
    accountEmail: thread.account?.emailAddress || "Unknown",
    sourceFolder: latestEmail?.sourceFolderPath || latestEmail?.sourceFolder || latestEmail?.folder || "INBOX",
    isBlocked,
    isSpam,
    needsReply: !isBlocked && !isSpam && latestDirection === "CLIENT REPLIED" && !hasDraft && !scheduled,
    priority: statusPriority(status, unread, latestDirection),
    latestClientReplyTime: latestInboundAt ? new Date(latestInboundAt).getTime() : 0
  };
}

function inboxEmailListSelect() {
  return {
    id: true,
    direction: true,
    fromName: true,
    fromEmail: true,
    toEmails: true,
    subject: true,
    snippet: true,
    folder: true,
    sourceFolder: true,
    sourceFolderPath: true,
    sentAt: true,
    isAutoReply: true,
    isBounce: true
  };
}

function statusPriority(status: string, unread: boolean, direction: string) {
  if (unread && direction === "CLIENT REPLIED") return 1;
  if (status === "Replied" || status === "Unread") return 2;
  if (status === "Follow-up Needed") return 3;
  if (status === "Draft Ready") return 4;
  if (status === "Scheduled") return 5;
  if (status === "Spam/Marketing") return 8;
  if (status === "Do Not Contact") return 9;
  return 6;
}

function nextActionForStatus(status: string, direction: string) {
  if (status === "Do Not Contact") return { label: "Blocked", className: "bg-red-100 text-red-700" };
  if (status === "Spam/Marketing") return { label: "Archive", className: "bg-slate-100 text-slate-600" };
  if (status === "Draft Ready") return { label: "Review Draft", className: "bg-emerald-100 text-emerald-700" };
  if (status === "Scheduled") return { label: "Waiting", className: "bg-blue-100 text-blue-700" };
  if (status === "Follow-up Needed") return { label: "Schedule Follow-up", className: "bg-amber-100 text-amber-700" };
  if (direction === "CLIENT REPLIED") return { label: "Generate AI Reply", className: "bg-accent text-white" };
  return { label: "Waiting", className: "bg-slate-100 text-slate-600" };
}

function detectSpamMarketing(thread: any, latestEmail: any) {
  const text = [thread.subject, latestEmail?.fromEmail, latestEmail?.fromName, latestEmail?.snippet, latestEmail?.textBody].filter(Boolean).join(" ");
  if (latestEmail?.isAutoReply || latestEmail?.isBounce) return true;
  return spamPatterns.some((pattern) => pattern.test(text));
}

function hasBlockedMarker(notes?: string | null) {
  return /\b(do not contact|unsubscribe|stop emailing|remove me|not interested|bounce|delivery failed|invalid email)\b/i.test(notes || "");
}

function relativeTime(value?: Date | string | null) {
  if (!value) return "";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function toIso(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
