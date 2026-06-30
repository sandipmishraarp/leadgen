import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { FollowupSafeBulkActions } from "@/components/FollowupSafeBulkActions";
import { GenerateDraftButton } from "@/components/GenerateDraftButton";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { requireUser } from "@/lib/auth";
import { FOLLOWUP_STATES, type FollowupState } from "@/lib/services/followup-state";
import { getSalesFollowupsForMailbox } from "@/lib/services/followups";
import { isLeadIntakeMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";

const tabs = [
  { id: "due", label: "All Due", state: FOLLOWUP_STATES.DUE },
  { id: "safe", label: "Auto Draft Safe", state: FOLLOWUP_STATES.DUE },
  { id: "attention", label: "Needs Attention", state: FOLLOWUP_STATES.DUE },
  { id: "drafts", label: "Draft Pending", state: FOLLOWUP_STATES.DRAFT_CREATED },
  { id: "scheduled", label: "Scheduled", state: FOLLOWUP_STATES.SCHEDULED },
  { id: "completed", label: "Completed", state: [FOLLOWUP_STATES.SENT_WAITING_REPLY, FOLLOWUP_STATES.CLIENT_REPLIED, FOLLOWUP_STATES.COMPLETED] },
  { id: "blocked", label: "Blocked", state: FOLLOWUP_STATES.DUE }
] as const;

const dueFilters = [
  { id: "all", label: "All Due" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "today", label: "Due Today" },
  { id: "final", label: "Final Follow-up" },
  { id: "safe", label: "Safe to Contact" },
  { id: "blocked", label: "Blocked" },
  { id: "bounced", label: "Bounced" },
  { id: "unsubscribed", label: "Unsubscribed" },
  { id: "not_interested", label: "Not Interested" }
] as const;

function overdueBadge(overdueDays: number) {
  if (overdueDays >= 14) return { label: "Critical", className: "border-red-200 bg-red-50 text-red-700" };
  if (overdueDays >= 7) return { label: "High", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Due", className: "border-blue-200 bg-blue-50 text-blue-700" };
}

function matchesDueFilter(item: Awaited<ReturnType<typeof getSalesFollowupsForMailbox>>[number], filter: string) {
  if (filter === "critical") return item.overdueDays >= 14;
  if (filter === "high") return item.overdueDays >= 7 && item.overdueDays <= 13;
  if (filter === "today") return item.overdueDays === 0;
  if (filter === "final") return /final/i.test(item.followupStage);
  if (filter === "blocked") return Boolean(item.contactBlock?.blocked);
  if (filter === "bounced") return item.contactBlock?.code === "BOUNCED";
  if (filter === "unsubscribed") return item.contactBlock?.code === "UNSUBSCRIBED";
  if (filter === "not_interested") return item.contactBlock?.code === "NOT_INTERESTED";
  if (filter === "safe") return !item.contactBlock?.blocked;
  return true;
}

function matchesBucketTab(item: Awaited<ReturnType<typeof getSalesFollowupsForMailbox>>[number], tabId: string) {
  if (tabId === "safe") return item.bucket === "AUTO_DRAFT_SAFE";
  if (tabId === "attention") return item.bucket === "NEEDS_HUMAN_ATTENTION";
  if (tabId === "blocked") return item.bucket === "BLOCKED";
  return true;
}

function bucketBadge(bucket: string) {
  if (bucket === "AUTO_DRAFT_SAFE") return { label: "Auto Draft Safe", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (bucket === "NEEDS_HUMAN_ATTENTION") return { label: "Needs Attention", className: "border-amber-200 bg-amber-50 text-amber-700" };
  if (bucket === "BLOCKED") return { label: "Blocked", className: "border-red-200 bg-red-50 text-red-700" };
  return { label: "Completed", className: "border-slate-200 bg-slate-50 text-slate-700" };
}

export default async function FollowupsPage({ searchParams }: { searchParams?: { mailbox?: string; tab?: string; filter?: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = await resolveMailboxContext(searchParams?.mailbox, "abhay@aresourcepool.com");
  const activeTab = tabs.find((tab) => tab.id === searchParams?.tab) || tabs[0];
  const [followups, dueFollowups, draftPendingFollowups, scheduledFollowups] = await Promise.all([
    getSalesFollowupsForMailbox(mailbox, activeTab.state as FollowupState | FollowupState[]),
    getSalesFollowupsForMailbox(mailbox, FOLLOWUP_STATES.DUE),
    getSalesFollowupsForMailbox(mailbox, FOLLOWUP_STATES.DRAFT_CREATED),
    getSalesFollowupsForMailbox(mailbox, FOLLOWUP_STATES.SCHEDULED)
  ]);
  const activeDueFilter = dueFilters.find((filter) => filter.id === searchParams?.filter)?.id || "all";
  const visibleFollowups = ["due", "safe", "attention", "blocked"].includes(activeTab.id)
    ? followups.filter((item) => matchesBucketTab(item, activeTab.id)).filter((item) => activeTab.id === "due" ? matchesDueFilter(item, activeDueFilter) : true)
    : followups;
  const safeCount = dueFollowups.filter((item) => item.bucket === "AUTO_DRAFT_SAFE").length;
  const attentionCount = dueFollowups.filter((item) => item.bucket === "NEEDS_HUMAN_ATTENTION").length;
  const blockedCount = dueFollowups.filter((item) => item.bucket === "BLOCKED").length;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Follow-ups</h1>
        <p className="text-sm text-slate-500">Sent emails and assigned leads that have not received a later client reply.</p>
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const params = new URLSearchParams();
          params.set("mailbox", mailbox.email);
          params.set("tab", tab.id);
          const active = activeTab.id === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/followups?${params.toString()}`}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${active ? "border-accent bg-accent text-white" : "border-line bg-white text-muted hover:text-ink"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {activeTab.id === "due" ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {dueFilters.map((filter) => {
            const params = new URLSearchParams();
            params.set("mailbox", mailbox.email);
            params.set("tab", "due");
            if (filter.id !== "all") params.set("filter", filter.id);
            const active = activeDueFilter === filter.id;
            return (
              <Link
                key={filter.id}
                href={`/followups?${params.toString()}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-line bg-white text-muted hover:text-ink"}`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      ) : null}
      {activeTab.id === "safe" ? <FollowupSafeBulkActions mailbox={mailbox.email} safeCount={safeCount} /> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Safe for Auto Draft", safeCount, "border-emerald-200 bg-emerald-50 text-emerald-900"],
          ["Needs Attention", attentionCount, "border-amber-200 bg-amber-50 text-amber-900"],
          ["Blocked", blockedCount, "border-red-200 bg-red-50 text-red-900"],
          ["Draft Pending", draftPendingFollowups.length, "border-blue-200 bg-blue-50 text-blue-900"],
          ["Scheduled", scheduledFollowups.length, "border-slate-200 bg-slate-50 text-slate-900"]
        ].map(([label, value, className]) => (
          <div key={String(label)} className={`rounded-xl border px-3 py-2 ${className}`}>
            <div className="text-xl font-bold">{String(value)}</div>
            <div className="text-xs font-semibold">{String(label)}</div>
          </div>
        ))}
      </div>
      {isLeadIntakeMailbox(mailbox) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Follow-ups are available for Sales mailboxes. Switch to Abhay or another Sales account to view sent-email follow-ups.
        </div>
      ) : null}
      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="grid grid-cols-[1.05fr_1.4fr_1fr_125px_130px_155px] border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Client</span>
          <span>Subject</span>
          <span>Bucket</span>
          <span>Last sent</span>
          <span>Stage</span>
          <span>Action</span>
        </div>
        <div className="divide-y divide-line">
          {visibleFollowups.map((item) => {
            const badge = overdueBadge(item.overdueDays);
            const bucket = bucketBadge(item.bucket);
            const primaryReasons = item.riskFlags.length ? item.riskFlags : item.dataQualityWarnings;
            const visibleReasons = primaryReasons.slice(0, 2);
            const hiddenReasonCount = Math.max(0, primaryReasons.length - visibleReasons.length);
            return (
              <div key={item.id} className={`grid grid-cols-[1.05fr_1.4fr_1fr_125px_130px_155px] gap-3 px-4 py-3 text-sm ${item.bucket === "BLOCKED" ? "bg-red-50/60 text-slate-500" : ""}`}>
                <div>
                  {item.leadId ? (
                    <Link href={`/leads/${item.leadId}`} className="font-semibold text-accent">
                      {item.leadName || item.clientEmail}
                    </Link>
                  ) : (
                    <Link href={`/inbox/${item.threadId}`} className="font-semibold text-accent">
                      {item.clientEmail}
                    </Link>
                  )}
                  <div className="mt-1 text-slate-500">{item.clientEmail}</div>
                  {item.contactBlock?.blocked ? <BlockBadge label={item.contactBlock.label} /> : null}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{item.subject || "(No subject)"}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-slate-500">{item.preview || "No preview available"}</div>
                </div>
                <div>
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${bucket.className}`}>
                    {bucket.label}
                  </span>
                  {visibleReasons.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {visibleReasons.map((flag) => (
                        <span key={flag} className={`rounded-full border px-2 py-0.5 text-[11px] ${item.riskFlags.includes(flag) ? "border-amber-200 bg-amber-50 text-amber-700" : "border-line bg-slate-50 text-slate-500"}`}>{flag}</span>
                      ))}
                      {hiddenReasonCount ? <span className="rounded-full border border-line bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">+{hiddenReasonCount} more</span> : null}
                    </div>
                  ) : null}
                  <details className="mt-1 text-xs text-slate-500">
                    <summary className="cursor-pointer font-semibold text-accent">View reasons</summary>
                    <div className="mt-1 rounded-md border border-line bg-white p-2 shadow-sm">
                      <div className="font-semibold text-slate-700">Why this bucket:</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        <li>{item.bucketReason}</li>
                        {item.riskFlags.map((flag) => <li key={flag}>{flag}</li>)}
                        {item.dataQualityWarnings.map((warning) => <li key={warning}>{warning} is only a warning</li>)}
                      </ul>
                    </div>
                  </details>
                </div>
                <div>
                  <div className="text-slate-700"><ClientDateTime value={item.lastSentAt} /></div>
                  <div className="mt-1 text-xs text-slate-500">{item.daysSinceSent} days since</div>
                </div>
                <div>
                  <div className="font-medium">{item.followupStage}</div>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
                    {item.overdueDays === 0 ? "Due today" : `${item.overdueDays}d overdue`}
                  </span>
                </div>
                <div>
                  {item.bucket === "BLOCKED" ? (
                    <div className="space-y-1">
                      <span className="inline-flex rounded-md border border-red-200 bg-red-100 px-2 py-1 text-xs font-bold text-red-700" title={item.contactBlock?.reason || item.bucketReason}>
                        View Reason
                      </span>
                      <div className="text-xs text-red-700">Archive / Mark Lost</div>
                    </div>
                  ) : item.bucket === "AUTO_DRAFT_SAFE" && ["due", "safe"].includes(activeTab.id) ? (
                    <GenerateDraftButton threadId={item.threadId} draftType="FOLLOWUP" label="Generate Draft" />
                  ) : item.bucket === "NEEDS_HUMAN_ATTENTION" && ["due", "attention"].includes(activeTab.id) ? (
                    <div className="space-y-2">
                      <Link href={item.leadId ? `/leads/${item.leadId}?mailbox=${encodeURIComponent(mailbox.email)}` : `/inbox/${item.threadId}`} className="font-semibold text-accent">
                        Open Lead
                      </Link>
                      <div className="text-xs text-slate-500">Generate Custom Draft</div>
                    </div>
                  ) : activeTab.id === "drafts" ? (
                    <Link href={item.leadId ? `/leads/${item.leadId}?mailbox=${encodeURIComponent(mailbox.email)}` : `/inbox/${item.threadId}`} className="font-semibold text-accent">
                      Open Draft
                    </Link>
                  ) : activeTab.id === "scheduled" ? (
                    <Link href={`/scheduled?mailbox=${encodeURIComponent(mailbox.email)}`} className="font-semibold text-accent">
                      View Scheduled
                    </Link>
                  ) : (
                    <span className="text-slate-500">Done</span>
                  )}
                </div>
              </div>
            );
          })}
          {!visibleFollowups.length ? <div className="px-5 py-8 text-sm text-slate-500">No {activeTab.label.toLowerCase()} follow-ups found for this mailbox.</div> : null}
        </div>
      </section>
    </AppShell>
  );
}

function BlockBadge({ label }: { label: string }) {
  return (
    <span className="mt-2 inline-flex rounded-full border border-red-200 bg-red-100 px-2 py-1 text-xs font-bold uppercase text-red-700">
      {label}
    </span>
  );
}
