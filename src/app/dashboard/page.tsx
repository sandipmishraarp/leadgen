import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, AlertCircle, ArrowUpRight, CheckCircle2, Clock3, DollarSign, Inbox, MessageCircle, MousePointerClick, Send, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { EmailAccountsDashboardWidget } from "@/components/EmailAccountsDashboardWidget";
import { SyncButton } from "@/components/SyncButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { getSalesFollowupsForMailbox } from "@/lib/services/followups";
import { resolveMailboxContext } from "@/lib/services/mailbox-filter";
import { getDailySalesCommandCenter } from "@/lib/services/sales-command-center";
import { ensureTrackingSyncScheduler } from "@/lib/services/tracking-gateway";

export default async function DashboardPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }
  ensureTrackingSyncScheduler();
  const commandCenter = await getDailySalesCommandCenter();
  const salesMailbox = await resolveMailboxContext("abhay@aresourcepool.com", "abhay@aresourcepool.com");
  const followupAutomationItems = await getSalesFollowupsForMailbox(salesMailbox, FOLLOWUP_STATES.DUE);
  const followupAutomationCounts = {
    due: followupAutomationItems.length,
    safe: followupAutomationItems.filter((item) => item.bucket === "AUTO_DRAFT_SAFE").length,
    attention: followupAutomationItems.filter((item) => item.bucket === "NEEDS_HUMAN_ATTENTION").length,
    blocked: followupAutomationItems.filter((item) => item.bucket === "BLOCKED").length
  };

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [
    draftCount,
    sentCount,
    inboxCount,
    waitingCount,
    dueTodayCount,
    repliesReceivedCount,
    newLeadsCount,
    waitingForSandipCount,
    approvedCount,
    rejectedCount,
    contactedCount,
    wonCount,
    lostCount,
    deliveredCount,
    openedCount,
    totalOpenCount,
    clickedLinksCount,
    latestOpen,
    averageEngagement,
    hotLeads,
    needsActionLeads,
    lowConfidenceLeads,
    revenueOpportunities,
    connectedAccountsCount,
    totalLeadIntakeEmails,
    todaysAccountSyncs,
    failedAccountSyncs,
    runningImportsCount,
    followupDueQueueCount,
    followupDraftPendingCount,
    followupScheduledCount,
    followupWaitingReplyCount,
    followupCompletedCount,
    recentThreads,
    logs,
    todaysOpens,
    todaysClicks,
    uniqueOpens,
    uniqueClicks,
    topOpenedLeads,
    topClickedLeads,
    repliesNeedingReviewCount,
    draftsReadyCount,
    blockedLeadsCount,
    scheduledTodayCount,
    failedSendsCount,
    whatsappDraftsCount,
    whatsappSentTodayCount,
    whatsappRepliesTodayCount,
    whatsappFailedCount
  ] = await Promise.all([
    prisma.draft.count({ where: { status: "DRAFT" } }),
    prisma.email.count({ where: { direction: "OUTBOUND" } }),
    prisma.email.count({ where: { direction: "INBOUND" } }),
    prisma.lead.count({ where: { waitingForReply: true } }),
    prisma.lead.count({ where: { waitingForReply: true, nextFollowUpAt: { lte: today } } }),
    prisma.email.count({ where: { direction: "INBOUND", isAutoReply: false, isBounce: false } }),
    prisma.leadIntake.count(),
    prisma.lead.count({ where: { status: "WAITING_FOR_SANDIP" } }),
    prisma.lead.count({ where: { status: "APPROVED" } }),
    prisma.lead.count({ where: { status: "REJECTED" } }),
    prisma.lead.count({ where: { status: "CONTACTED" } }),
    prisma.lead.count({ where: { status: "WON" } }),
    prisma.lead.count({ where: { status: "LOST" } }),
    prisma.emailEngagement.count({ where: { deliveredAt: { not: null } } }),
    prisma.emailEngagement.count({ where: { openCount: { gt: 0 } } }),
    prisma.emailEngagement.aggregate({ _sum: { openCount: true } }),
    prisma.linkClick.count(),
    prisma.emailEngagement.findFirst({
      where: { lastOpenAt: { not: null } },
      orderBy: { lastOpenAt: "desc" }
    }),
    prisma.emailEngagement.aggregate({ _avg: { engagementScore: true } }),
    prisma.leadQualification.findMany({
      where: { classification: "HOT" },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 5,
      include: { lead: true }
    }),
    prisma.leadQualification.findMany({
      where: {
        recommendedAction: { not: null },
        classification: { in: ["HOT", "WARM"] },
        lead: { status: { notIn: ["WON", "LOST", "ARCHIVED", "REJECTED"] } }
      },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 5,
      include: { lead: true }
    }),
    prisma.lead.findMany({
      where: {
        OR: [
          { clientEmailConfidence: null },
          { clientEmailConfidence: { lt: 80 } }
        ],
        status: { notIn: ["WON", "LOST", "ARCHIVED", "REJECTED"] }
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.leadQualification.findMany({
      where: { dealSizeEstimate: { not: null }, classification: { in: ["HOT", "WARM"] } },
      orderBy: [{ dealSizeEstimate: "desc" }, { score: "desc" }],
      take: 5,
      include: { lead: true }
    }),
    prisma.emailAccount.count({ where: { isActive: true, status: { not: "ERROR" } } }),
    prisma.leadIntake.count(),
    prisma.emailAccount.count({ where: { lastSyncedAt: { gte: startOfToday } } }),
    prisma.emailAccount.count({ where: { status: "ERROR" } }),
    prisma.leadImportJob.count({ where: { status: "RUNNING" } }),
    prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.DUE } }),
    prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.DRAFT_CREATED } }),
    prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.SCHEDULED } }),
    prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.SENT_WAITING_REPLY } }),
    prisma.lead.count({ where: { followupState: { in: [FOLLOWUP_STATES.CLIENT_REPLIED, FOLLOWUP_STATES.COMPLETED, FOLLOWUP_STATES.CANCELLED] } } }),
    prisma.emailThread.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      include: { lead: true, emails: { orderBy: { sentAt: "desc" }, take: 1 } }
    }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.emailEngagement.aggregate({ where: { lastOpenAt: { gte: startOfToday } }, _sum: { openCount: true } }),
    prisma.linkClick.count({ where: { clickedAt: { gte: startOfToday } } }),
    prisma.emailEngagement.count({ where: { firstOpenAt: { gte: startOfToday } } }),
    prisma.linkClick.findMany({ where: { clickedAt: { gte: startOfToday } }, distinct: ["engagementId"], select: { engagementId: true } }),
    prisma.emailEngagement.findMany({
      where: { openCount: { gt: 0 } },
      orderBy: [{ openCount: "desc" }, { lastOpenAt: "desc" }],
      take: 250,
      include: { sentEmail: { include: { thread: { include: { lead: true, sentEmails: { select: { id: true } } } } } } }
    }),
    prisma.emailEngagement.findMany({
      where: { clickedLinks: { gt: 0 } },
      orderBy: [{ clickedLinks: "desc" }, { lastClickedAt: "desc" }],
      take: 250,
      include: { sentEmail: { include: { thread: { include: { lead: true, sentEmails: { select: { id: true } } } } } } }
    }),
    prisma.lead.count({ where: { status: "REPLIED" } }),
    prisma.draft.count({ where: { status: "DRAFT", isCurrent: true } }),
    prisma.activityLog.count({
      where: {
        OR: [
          { message: { contains: "Do-not-contact", mode: "insensitive" } },
          { message: { contains: "Bounce detected", mode: "insensitive" } }
        ]
      }
    }),
    prisma.scheduledEmail.count({ where: { scheduledAt: { gte: startOfToday, lte: today }, status: { in: ["SCHEDULED", "QUEUED", "RETRY"] } } }),
    prisma.scheduledEmail.count({ where: { status: "FAILED" } }),
    safeWhatsAppCount({ where: { status: "DRAFT" } }),
    safeWhatsAppCount({ where: { status: "SENT", sentAt: { gte: startOfToday } } }),
    safeWhatsAppCount({ where: { direction: "INBOUND", receivedAt: { gte: startOfToday } } }),
    safeWhatsAppCount({ where: { status: "FAILED" } })
  ]);
  const ctr = (todaysOpens._sum.openCount || 0) ? Math.round((todaysClicks / (todaysOpens._sum.openCount || 1)) * 100) : 0;
  const topOpenedLeadRows = aggregateLeadTracking(topOpenedLeads, "opens");
  const topClickedLeadRows = aggregateLeadTracking(topClickedLeads, "clicks");

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
            <Sparkles size={14} className="text-accent" />
            Approval-based sales workspace
          </div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Pipeline, inbox intelligence, drafts, follow-ups, and engagement in one focused view.</p>
        </div>
        <SyncButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="New Leads" value={newLeadsCount} detail="Imported opportunities" icon={Users} accent="teal" />
        <MetricCard label="Drafts Pending" value={draftCount} detail="Need approval" icon={Sparkles} accent="blue" />
        <MetricCard label="Follow-ups Due" value={dueTodayCount} detail="Waiting for action" icon={Clock3} accent="amber" />
        <MetricCard label="Engagement Score" value={Math.round(averageEngagement._avg.engagementScore || 0)} detail={`${openedCount} opened · ${clickedLinksCount} clicks`} icon={TrendingUp} accent="violet" />
      </div>

      <section className="mt-6 premium-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Daily Work Queue</h2>
            <p className="text-sm text-muted">{commandCenter.morningBrief}</p>
          </div>
          <Sparkles size={18} className="text-accent" />
        </div>
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {[
            ["Replies needing review", commandCenter.counts.replies || repliesNeedingReviewCount, "/inbox?tab=needs-reply"],
            ["Drafts ready", commandCenter.counts.drafts || draftsReadyCount, "/drafts"],
            ["Follow-ups ready", commandCenter.counts.followups || followupDraftPendingCount, "/followups?tab=draft-pending"],
            ["Blocked leads", commandCenter.counts.blocked || blockedLeadsCount, "/inbox?tab=blocked"],
            ["Scheduled today", commandCenter.counts.scheduledToday || scheduledTodayCount, "/scheduled"],
            ["Failed sends", commandCenter.counts.failedSends || failedSendsCount, "/scheduled"],
            ["Hot leads", commandCenter.counts.hotLeads || hotLeads.length, "/leads"]
          ].map(([label, value, href]) => (
            <Link key={String(label)} href={String(href)} className="rounded-2xl border border-line bg-subtle p-4 transition hover:border-strong">
              <div className="text-2xl font-bold">{String(value)}</div>
              <div className="mt-1 text-xs font-medium text-muted">{String(label)}</div>
            </Link>
          ))}
        </div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-[minmax(0,1.1fr)_120px_110px_minmax(0,1.2fr)_150px] bg-subtle px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted max-lg:hidden">
            <span>Client</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Reason</span>
            <span>Action</span>
          </div>
          <div className="divide-y divide-line bg-surface">
            {commandCenter.actions.map((item) => (
              <Link key={item.id} href={item.href} className="grid gap-3 px-4 py-3 text-sm transition hover:bg-subtle lg:grid-cols-[minmax(0,1.1fr)_120px_110px_minmax(0,1.2fr)_150px]">
                <div className="min-w-0">
                  <div className="truncate font-bold">{item.client}</div>
                  <div className="truncate text-xs text-muted">{item.email}</div>
                </div>
                <div className="text-xs font-semibold text-muted">{item.status.replaceAll("_", " ")}</div>
                <div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.priority >= 70 ? "bg-emerald-50 text-emerald-700" : item.priority >= 40 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {item.priority}/100
                  </span>
                </div>
                <div className="line-clamp-2 text-xs text-muted">{item.reason}</div>
                <div className="font-bold text-accent">{item.recommendedAction}</div>
              </Link>
            ))}
            {!commandCenter.actions.length ? (
              <div className="px-4 py-6 text-sm text-muted">No priority actions yet. New replies, drafts, failed sends, and due follow-ups will appear here.</div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-6 premium-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">WhatsApp CRM</h2>
            <p className="text-sm text-muted">Human-approved WhatsApp drafts, replies, and failures.</p>
          </div>
          <MessageCircle size={18} className="text-accent" />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Drafts Ready" value={whatsappDraftsCount} detail="Need approval" icon={MessageCircle} accent="teal" />
          <MetricCard label="Sent Today" value={whatsappSentTodayCount} detail="Manual sends" icon={Send} accent="blue" />
          <MetricCard label="Replies Today" value={whatsappRepliesTodayCount} detail="Client WhatsApp replies" icon={Inbox} accent="teal" />
          <MetricCard label="Failed" value={whatsappFailedCount} detail="Need review" icon={AlertCircle} accent="amber" />
        </div>
      </section>

      <section className="mt-6 premium-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Follow-up Queue</h2>
            <p className="text-sm text-muted">One active follow-up state per lead.</p>
          </div>
          <Clock3 size={18} className="text-accent" />
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["Due", followupDueQueueCount],
            ["Draft Pending", followupDraftPendingCount],
            ["Scheduled", followupScheduledCount],
            ["Waiting Reply", followupWaitingReplyCount],
            ["Completed", followupCompletedCount]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-line bg-subtle p-4">
              <div className="text-2xl font-bold">{String(value)}</div>
              <div className="mt-1 text-xs font-medium text-muted">{String(label)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 premium-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Follow-up Automation</h2>
            <p className="text-sm text-muted">Safe auto-drafts are separated from leads needing human attention.</p>
          </div>
          <Sparkles size={18} className="text-accent" />
        </div>
        <div className="grid gap-3 md:grid-cols-6">
          {[
            ["Due total", followupAutomationCounts.due, "/followups?tab=due"],
            ["Auto Draft Safe", followupAutomationCounts.safe, "/followups?tab=safe"],
            ["Needs Attention", followupAutomationCounts.attention, "/followups?tab=attention"],
            ["Draft Pending", followupDraftPendingCount, "/followups?tab=drafts"],
            ["Scheduled", followupScheduledCount, "/followups?tab=scheduled"],
            ["Blocked", followupAutomationCounts.blocked, "/followups?tab=blocked"]
          ].map(([label, value, href]) => (
            <Link key={String(label)} href={String(href)} className="rounded-2xl border border-line bg-subtle p-4 transition hover:border-accent">
              <div className="text-2xl font-bold">{String(value)}</div>
              <div className="mt-1 text-xs font-medium text-muted">{String(label)}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-6 premium-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Tracking Gateway</h2>
            <p className="text-sm text-muted">Opens and clicks synced from track.aresourcepool.com.</p>
          </div>
          <MousePointerClick size={18} className="text-accent" />
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["Today's Opens", todaysOpens._sum.openCount || 0],
            ["Today's Clicks", todaysClicks],
            ["Unique Opens", uniqueOpens],
            ["Unique Clicks", uniqueClicks.length],
            ["CTR", `${ctr}%`]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-line bg-subtle p-4">
              <div className="text-2xl font-bold">{String(value)}</div>
              <div className="mt-1 text-xs font-medium text-muted">{String(label)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TrackingLeadList title="Top Opened Leads" items={topOpenedLeadRows} />
          <TrackingLeadList title="Top Clicked Leads" items={topClickedLeadRows} />
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="premium-card p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">Email Performance</h2>
              <p className="text-sm text-muted">Delivery, opens, replies, and clicks.</p>
            </div>
            <Activity size={18} className="text-accent" />
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {([
              ["Inbox", inboxCount, Inbox],
              ["Sent", sentCount, Send],
              ["Delivered", deliveredCount, CheckCircle2],
              ["Replies", repliesReceivedCount, ArrowUpRight],
              ["Clicks", clickedLinksCount, MousePointerClick]
            ] as [string, number, LucideIcon][])
            .map(([label, value, Icon]) => (
              <div key={label} className="rounded-2xl border border-line bg-subtle p-4">
                <Icon size={18} className="mb-3 text-accent" />
                <div className="text-2xl font-bold">{value}</div>
                <div className="mt-1 text-xs font-medium text-muted">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(5, Math.round(((openedCount || 0) / Math.max(1, deliveredCount || 1)) * 100)))}%` }} />
          </div>
          <div className="mt-2 text-xs text-muted">Open rate proxy based on tracked delivered emails.</div>
        </section>

        <section className="premium-card p-5">
          <h2 className="font-bold">Pipeline Board</h2>
          <p className="mb-4 text-sm text-muted">A compact Kanban snapshot.</p>
          <div className="grid gap-3">
            {[
              ["Waiting", waitingForSandipCount, "Needs review"],
              ["Approved", approvedCount, "Ready for outreach"],
              ["Contacted", contactedCount, "Waiting for reply"],
              ["Won", wonCount, "Closed"],
              ["Lost", lostCount, "Archived outcome"]
            ].map(([label, count, detail]) => (
              <div key={String(label)} className="kanban-column">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">{String(label)}</div>
                    <div className="text-xs text-muted">{String(detail)}</div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-1 text-lg font-bold shadow-sm">{String(count)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-6">
        <EmailAccountsDashboardWidget
          connectedAccounts={connectedAccountsCount}
          totalImportedEmails={inboxCount + sentCount + totalLeadIntakeEmails}
          todaysSync={todaysAccountSyncs}
          failedSync={failedAccountSyncs}
          runningImports={runningImportsCount}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-4">
        <IntelligenceList
          title="Hot Leads"
          icon={TrendingUp}
          empty="No hot leads scored yet."
          items={hotLeads.map((item) => ({
            href: `/leads/${item.leadId}`,
            title: item.lead.name || item.lead.email,
            detail: `${item.score}/100 · ${item.winProbability}% win`
          }))}
        />
        <IntelligenceList
          title="Needs Action"
          icon={Clock3}
          empty="No scored leads need action."
          items={needsActionLeads.map((item) => ({
            href: `/leads/${item.leadId}`,
            title: item.lead.name || item.lead.email,
            detail: item.recommendedAction || `${item.classification} · ${item.score}/100`
          }))}
        />
        <IntelligenceList
          title="Low Confidence"
          icon={AlertCircle}
          empty="No low-confidence leads."
          items={lowConfidenceLeads.map((lead) => ({
            href: `/leads/${lead.id}`,
            title: lead.name || lead.email,
            detail: `Email confidence ${lead.clientEmailConfidence ?? 0}%`
          }))}
        />
        <IntelligenceList
          title="Revenue Opportunities"
          icon={DollarSign}
          empty="No revenue estimates yet."
          items={revenueOpportunities.map((item) => ({
            href: `/leads/${item.leadId}`,
            title: item.lead.name || item.lead.email,
            detail: `$${(item.dealSizeEstimate || 0).toLocaleString()} est. · ${item.classification}`
          }))}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-lg border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-bold">Recent Threads</h2>
          </div>
          <div className="divide-y divide-line">
            {recentThreads.map((thread) => (
              <Link key={thread.id} href={`/inbox/${thread.id}`} className="block px-5 py-4 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold">{thread.subject}</div>
                    <div className="mt-1 text-sm text-slate-500">{thread.lead?.email || "No lead linked"}</div>
                  </div>
                  <div className="text-sm text-slate-500"><ClientDateTime value={thread.lastMessageAt} fallback="No date" timeStyle="short" /></div>
                </div>
              </Link>
            ))}
            {!recentThreads.length ? <div className="px-5 py-8 text-sm text-slate-500">No synced emails yet.</div> : null}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-bold">Activity</h2>
          </div>
          <div className="divide-y divide-line">
            {logs.map((log) => (
              <div key={log.id} className="timeline-item px-5 py-4">
                <div className="text-sm font-medium">{log.message}</div>
                <div className="mt-1 text-xs text-slate-500"><ClientDateTime value={log.createdAt} timeStyle="short" /></div>
              </div>
            ))}
            {!logs.length ? <div className="px-5 py-8 text-sm text-slate-500">No activity yet.</div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function IntelligenceList({
  title,
  icon: Icon,
  items,
  empty
}: {
  title: string;
  icon: LucideIcon;
  items: Array<{ href: string; title: string; detail: string }>;
  empty: string;
}) {
  return (
    <section className="premium-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-bold">{title}</h2>
        <Icon size={18} className="text-accent" />
      </div>
      <div className="space-y-3">
        {items.length ? items.map((item) => (
          <Link key={`${item.href}-${item.title}`} href={item.href} className="block rounded-lg border border-line bg-subtle p-3 transition hover:border-accent">
            <div className="truncate text-sm font-bold">{item.title}</div>
            <div className="mt-1 line-clamp-2 text-xs text-muted">{item.detail}</div>
          </Link>
        )) : <div className="rounded-lg border border-dashed border-line bg-subtle p-4 text-sm text-muted">{empty}</div>}
      </div>
    </section>
  );
}

function TrackingLeadList({ title, items }: { title: string; items: LeadTrackingAggregate[] }) {
  return (
    <div className="rounded-2xl border border-line bg-subtle p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.length ? items.map((item, index) => (
          <Link key={`${title}-${index}-${item.email}`} href={item.lead ? `/leads/${item.lead.id}` : "#"} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-accent">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{item.lead?.name || item.lead?.email || item.email || "Unknown lead"}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {item.emailsSent} sent · {item.uniqueOpens} unique opens · CTR {item.clickRate}%
              </span>
            </span>
            <span className="shrink-0 text-right text-xs font-bold text-accent">
              <span className="block">{item.totalOpens} opens</span>
              <span className="block">{item.totalClicks} clicks</span>
            </span>
          </Link>
        )) : <div className="text-sm text-muted">No tracked activity yet.</div>}
      </div>
    </div>
  );
}

type LeadTrackingAggregate = {
  lead: { id: string; name: string | null; email: string } | null;
  email: string;
  emailsSent: number;
  totalOpens: number;
  uniqueOpens: number;
  totalClicks: number;
  uniqueClicks: number;
  openRate: number;
  clickRate: number;
  firstOpenAt: Date | null;
  lastOpenAt: Date | null;
  firstClickAt: Date | null;
  lastClickAt: Date | null;
};

function aggregateLeadTracking(items: any[], mode: "opens" | "clicks"): LeadTrackingAggregate[] {
  const byLead = new Map<string, LeadTrackingAggregate & { sentEmailIds: Set<string> }>();
  for (const engagement of items) {
    const lead = engagement.sentEmail?.thread?.lead || null;
    const key = lead?.id || engagement.sentEmail?.toEmails?.[0] || engagement.sentEmailId;
    const current = byLead.get(key) || {
      lead,
      email: lead?.email || engagement.sentEmail?.toEmails?.[0] || "",
      emailsSent: Array.isArray(engagement.sentEmail?.thread?.sentEmails) ? engagement.sentEmail.thread.sentEmails.length : 0,
      totalOpens: 0,
      uniqueOpens: 0,
      totalClicks: 0,
      uniqueClicks: 0,
      openRate: 0,
      clickRate: 0,
      firstOpenAt: null,
      lastOpenAt: null,
      firstClickAt: null,
      lastClickAt: null,
      sentEmailIds: new Set<string>()
    };
    current.sentEmailIds.add(engagement.sentEmailId);
    current.totalOpens += Number(engagement.openCount || 0);
    current.totalClicks += Number(engagement.clickedLinks || 0);
    if (engagement.openCount > 0) current.uniqueOpens += 1;
    if (engagement.clickedLinks > 0) current.uniqueClicks += 1;
    current.firstOpenAt = minDate([current.firstOpenAt, engagement.firstOpenAt]);
    current.lastOpenAt = maxDate([current.lastOpenAt, engagement.lastOpenAt]);
    current.firstClickAt = minDate([current.firstClickAt, engagement.lastClickedAt]);
    current.lastClickAt = maxDate([current.lastClickAt, engagement.lastClickedAt]);
    byLead.set(key, current);
  }
  return [...byLead.values()]
    .map((item) => {
      item.emailsSent = Math.max(item.emailsSent, item.sentEmailIds.size);
      item.openRate = item.emailsSent ? Math.round((item.uniqueOpens / item.emailsSent) * 100) : 0;
      item.clickRate = item.emailsSent ? Math.round((item.uniqueClicks / item.emailsSent) * 100) : 0;
      return item;
    })
    .sort((a, b) => {
      const primary = mode === "opens" ? b.totalOpens - a.totalOpens : b.totalClicks - a.totalClicks;
      return primary || timeValue(mode === "opens" ? b.lastOpenAt : b.lastClickAt) - timeValue(mode === "opens" ? a.lastOpenAt : a.lastClickAt);
    })
    .slice(0, 10);
}

function minDate(values: Array<Date | string | null | undefined>) {
  const dates = values.filter(Boolean).map((value) => new Date(value as Date | string)).filter((date) => !Number.isNaN(date.getTime()));
  return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
}

function maxDate(values: Array<Date | string | null | undefined>) {
  const dates = values.filter(Boolean).map((value) => new Date(value as Date | string)).filter((date) => !Number.isNaN(date.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

function timeValue(value: Date | string | null | undefined) {
  return value ? new Date(value).getTime() || 0 : 0;
}

function safeWhatsAppCount(args: any) {
  const delegate = (prisma as any).whatsAppMessage;
  return typeof delegate?.count === "function"
    ? delegate.count(args).catch(() => 0)
    : Promise.resolve(0);
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  accent: "teal" | "blue" | "amber" | "violet";
}) {
  const accents = {
    teal: "from-teal-500/20 to-emerald-500/5 text-teal-600",
    blue: "from-blue-500/20 to-sky-500/5 text-blue-600",
    amber: "from-amber-500/20 to-orange-500/5 text-amber-600",
    violet: "from-violet-500/20 to-fuchsia-500/5 text-violet-600"
  };
  return (
    <div className="premium-card overflow-hidden p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-muted">{label}</div>
          <div className="mt-2 text-4xl font-bold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-muted">{detail}</div>
        </div>
        <div className={`rounded-2xl bg-gradient-to-br p-3 ${accents[accent]}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}
