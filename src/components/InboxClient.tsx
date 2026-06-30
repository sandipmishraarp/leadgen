"use client";

import Link from "next/link";
import { ClientDateTime } from "@/components/ClientDateTime";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { SyncButton } from "@/components/SyncButton";

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

type InboxRow = {
  id: string;
  subject: string;
  clientName: string;
  clientEmail: string;
  preview: string;
  latestDirection: string;
  latestAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  daysSinceReply: number | null;
  unread: boolean;
  status: string;
  nextAction: string;
  actionClass: string;
  owner: string;
  accountEmail: string;
  sourceFolder: string;
  isBlocked: boolean;
  isSpam: boolean;
  needsReply: boolean;
  priority: number;
  latestClientReplyTime: number;
};

type InboxSummary = {
  unread: number;
  needsReply: number;
  followups: number;
  drafts: number;
  blocked: number;
  spam: number;
};

type Mailbox = {
  email: string;
  role: string;
};

const tabs: Array<{ id: InboxTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "client-replies", label: "Client Replies" },
  { id: "needs-reply", label: "Needs Reply" },
  { id: "follow-up-needed", label: "Follow-up Needed" },
  { id: "draft-ready", label: "Draft Ready" },
  { id: "scheduled", label: "Scheduled" },
  { id: "safe", label: "Safe to Contact" },
  { id: "blocked", label: "Blocked" },
  { id: "spam", label: "Spam/Marketing" }
];

export function InboxClient({
  rows,
  summary,
  mailbox,
  activeTab
}: {
  rows: InboxRow[];
  summary: InboxSummary;
  mailbox: Mailbox;
  activeTab: InboxTab;
}) {
  const visibleRows = rows.filter((row) => matchesTab(row, activeTab)).sort(sortInboxRows);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sales Action Inbox</h1>
          <p className="text-sm text-slate-500">Prioritized replies, follow-ups, drafts, and safe next actions.</p>
        </div>
        <SyncButton />
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />

      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Unread client replies" value={summary.unread} tone="blue" />
        <SummaryCard label="Needs reply" value={summary.needsReply} tone="amber" />
        <SummaryCard label="Follow-ups due" value={summary.followups} tone="amber" />
        <SummaryCard label="Drafts ready" value={summary.drafts} tone="green" />
        <SummaryCard label="Blocked" value={summary.blocked} tone="red" />
        <SummaryCard label="Spam/marketing" value={summary.spam} tone="slate" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const params = new URLSearchParams();
          params.set("tab", tab.id);
          params.set("mailbox", mailbox.email);
          return (
            <Link
              key={tab.id}
              href={`/inbox?${params.toString()}`}
              className={`rounded-full border px-3 py-2 text-sm font-semibold ${
                activeTab === tab.id ? "border-accent bg-accent text-white" : "border-line bg-white text-slate-700"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <section className="mb-4 rounded-lg border border-line bg-white p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate-700">Bulk actions</span>
          <button className="rounded-md border border-line px-3 py-1.5 text-slate-600" type="button">Mark read</button>
          <button className="rounded-md border border-line px-3 py-1.5 text-slate-600" type="button">Archive</button>
          <button className="rounded-md border border-line px-3 py-1.5 text-slate-600" type="button">Mark spam/marketing</button>
          <button className="rounded-md border border-line px-3 py-1.5 text-slate-600" type="button">Generate drafts for safe replies</button>
          <button className="rounded-md border border-line px-3 py-1.5 text-slate-600" type="button">Assign owner</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="grid grid-cols-[minmax(0,1.2fr)_170px_160px_190px] border-b border-line bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-600 max-xl:hidden">
          <span>Thread</span>
          <span>Status</span>
          <span>Last email</span>
          <span>Next action</span>
        </div>
        <div className="divide-y divide-line">
          {visibleRows.map((row) => (
            <Link
              key={row.id}
              href={`/inbox/${row.id}`}
              className={`grid gap-4 px-5 py-4 hover:bg-slate-50 xl:grid-cols-[minmax(0,1.2fr)_170px_160px_190px] ${
                row.unread && row.latestDirection === "CLIENT REPLIED" ? "border-l-4 border-accent bg-blue-50/40" : row.isSpam ? "bg-slate-50/80 opacity-75" : row.isBlocked ? "bg-red-50/50" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" aria-label={`Select ${row.subject}`} onClick={(event) => event.preventDefault()} />
                  <div className={`truncate ${row.unread ? "font-extrabold" : "font-semibold"}`}>{row.clientName}</div>
                  <DirectionBadge direction={row.latestDirection} />
                  {row.unread && row.latestDirection === "CLIENT REPLIED" ? <Badge tone="blue">New reply</Badge> : null}
                </div>
                <div className="mt-1 truncate text-sm text-slate-600">{row.clientEmail}</div>
                <div className={`mt-1 truncate ${row.unread ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>{row.subject}</div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-500">{row.preview}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Last inbound: {row.lastInboundAt ? <ClientDateTime value={row.lastInboundAt} fallback="--" timeStyle="short" /> : "None"}</span>
                  <span>Last outbound: {row.lastOutboundAt ? <ClientDateTime value={row.lastOutboundAt} fallback="--" timeStyle="short" /> : "None"}</span>
                  <span>Days since reply: {row.daysSinceReply ?? "--"}</span>
                  <span>Owner: {row.owner}</span>
                  <span>Account: {row.accountEmail}</span>
                  <span>Folder: {row.sourceFolder}</span>
                </div>
              </div>
              <div className="flex items-start xl:block">
                <StatusBadge status={row.status} />
              </div>
              <div className="text-sm text-slate-500">
                <ClientDateTime value={row.latestAt} fallback="No date" timeStyle="short" />
                <div className="mt-1 font-medium text-slate-600">{relativeTime(row.latestAt)}</div>
              </div>
              <div>
                <span className={`inline-flex rounded-lg px-3 py-2 text-sm font-bold ${row.actionClass}`}>{row.nextAction}</span>
              </div>
            </Link>
          ))}
          {!visibleRows.length ? (
            <div className="px-5 py-8 text-sm text-slate-500">
              No inbox threads found for this filter. Real client replies will appear above spam and scheduled/draft items.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function matchesTab(row: InboxRow, tab: InboxTab) {
  if (tab === "all") return true;
  if (tab === "unread") return row.unread;
  if (tab === "client-replies") return row.latestDirection === "CLIENT REPLIED";
  if (tab === "needs-reply") return row.needsReply;
  if (tab === "follow-up-needed") return row.status === "Follow-up Needed";
  if (tab === "draft-ready") return row.status === "Draft Ready";
  if (tab === "scheduled") return row.status === "Scheduled";
  if (tab === "safe") return !row.isBlocked && !row.isSpam;
  if (tab === "blocked") return row.isBlocked;
  if (tab === "spam") return row.isSpam;
  return true;
}

function sortInboxRows(a: InboxRow, b: InboxRow) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.latestClientReplyTime !== b.latestClientReplyTime) return b.latestClientReplyTime - a.latestClientReplyTime;
  return new Date(b.latestAt || 0).getTime() - new Date(a.latestAt || 0).getTime();
}

function relativeTime(value?: string | null) {
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

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "green" | "red" | "slate" }) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-line bg-white text-slate-700"
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Badge({ children, tone = "slate" }: { children: string; tone?: "blue" | "slate" }) {
  const className = tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-line bg-white text-slate-600";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${className}`}>{children}</span>;
}

function DirectionBadge({ direction }: { direction: string }) {
  const className = direction === "CLIENT REPLIED"
    ? "border-blue-200 bg-blue-50 text-blue-700"
    : direction === "OUR LAST EMAIL"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-extrabold ${className}`}>{direction}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const className = status === "Do Not Contact"
    ? "border-red-200 bg-red-50 text-red-700"
    : status === "Spam/Marketing"
    ? "border-slate-200 bg-slate-100 text-slate-600"
    : status === "Unread" || status === "Replied"
    ? "border-blue-200 bg-blue-50 text-blue-700"
    : status === "Draft Ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "Follow-up Needed"
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : "border-line bg-white text-slate-600";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>{status}</span>;
}
