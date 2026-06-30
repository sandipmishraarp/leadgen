import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { DraftEditor } from "@/components/DraftEditor";
import { HybridReplyActions } from "@/components/HybridReplyActions";
import { LeadDetailTabs } from "@/components/LeadDetailTabs";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildLeadIntelligence } from "@/lib/services/lead-intelligence";

export default async function EmailDetailPage({ params }: { params: { id: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const thread = await prisma.emailThread.findUnique({
    where: { id: params.id },
    include: {
      lead: {
        include: {
          qualification: true,
          clientBrain: true,
          websiteVisits: true,
          proposalViews: true
        }
      },
      emails: { orderBy: { sentAt: "asc" } },
      drafts: { orderBy: { createdAt: "desc" } },
      sentEmails: { orderBy: { sentAt: "desc" }, include: { engagement: true } }
    }
  });
  if (!thread) redirect("/inbox");

  const latestDraft = thread.drafts[0];
  const latestEmail = thread.emails.at(-1);
  const latestInboundEmail = latestInbound(thread.emails);
  const lead = thread.lead;
  const clientEmail = lead?.email || latestInboundEmail?.fromEmail || thread.emails[0]?.fromEmail || "No client email";
  const clientName = lead?.name || latestInboundEmail?.fromName || clientEmail;
  const intelligence = lead ? buildLeadIntelligence(lead) : null;
  const engagement = summarizeEngagement(thread.sentEmails);
  const latestSent = latestOutbound(thread.emails)?.sentAt || thread.sentEmails[0]?.sentAt || lead?.lastOutboundAt || null;
  const latestReply = latestInbound(thread.emails)?.sentAt || lead?.lastInboundAt || null;
  const nextBestAction = lead?.clientBrain?.nextBestAction || lead?.clientBrain?.recommendedNextStep || lead?.qualification?.recommendedAction || "Review the latest message and send a clear next-step reply.";
  const scoreLabel = lead?.qualification ? `${lead.qualification.score}/100 · ${lead.qualification.classification.replaceAll("_", " ")}` : "Not scored";

  return (
    <AppShell>
      <div className="sticky top-0 z-30 -mx-2 mb-4 rounded-2xl border border-line bg-white/95 px-4 py-3 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold">{thread.subject}</h1>
              <Badge tone={latestEmail?.direction === "OUTBOUND" ? "green" : "blue"}>{latestEmail?.direction === "OUTBOUND" ? "Sent" : "Received"}</Badge>
              {lead ? <Badge>{lead.status.replaceAll("_", " ")}</Badge> : <Badge>No lead linked</Badge>}
              <Badge tone={lead?.qualification?.classification === "HOT" ? "green" : "slate"}>{scoreLabel}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span>{clientName}</span>
              <span>{clientEmail}</span>
              <span>{lead?.company || "Company not set"}</span>
              {lead?.website ? <a className="text-accent hover:underline" href={withProtocol(lead.website)} target="_blank" rel="noreferrer">{lead.website}</a> : <span>Website not set</span>}
              <span>Owner: {lead?.assignedUser || "Unassigned"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <HybridReplyActions threadId={thread.id} hasDraft={Boolean(latestDraft)} />
            {lead ? <LeadStatusSelect leadId={lead.id} status={lead.status} /> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <LeadDetailTabs
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <div className="space-y-4">
                  <section className="rounded-xl border border-line bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="font-bold">CRM Summary</h2>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Inbox context</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <Info label="Client" value={clientName} />
                      <Info label="Email" value={clientEmail} />
                      <Info label="Company" value={lead?.company || "Not set"} />
                      <Info label="Website" value={lead?.website || "Not set"} />
                      <Info label="Service" value={lead?.service || "Not set"} />
                      <Info label="Owner" value={lead?.assignedUser || "Unassigned"} />
                    </div>
                  </section>
                  {intelligence ? (
                    <section className="rounded-xl border border-line bg-white p-4">
                      <h2 className="font-bold">Lead Intelligence</h2>
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Info label="Local time" value={intelligence.currentLocalTime} />
                        <Info label="Best window" value={intelligence.bestEmailWindow} />
                        <Info label="Recommendation" value={intelligence.sendNowRecommendation} />
                        <Info label="Reply chance" value={intelligence.replyProbability} />
                      </div>
                      <p className="mt-3 rounded-lg border border-line bg-subtle p-3 text-sm text-muted">{intelligence.suggestedEmailAngle}</p>
                    </section>
                  ) : null}
                  <section className="rounded-xl border border-line bg-white p-4">
                    <h2 className="font-bold">Next Best Action</h2>
                    <p className="mt-2 rounded-lg border border-line bg-subtle p-3 text-sm leading-6 text-muted">{nextBestAction}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Info label="Follow-up stage" value={lead?.followupStage ? `Follow-up ${lead.followupStage}` : "Not started"} />
                      <Info label="Last sent" value={<ClientDateTime value={latestSent} fallback="None" timeStyle="short" />} />
                      <Info label="Last reply" value={<ClientDateTime value={latestReply} fallback="None" timeStyle="short" />} />
                      <Info label="Engagement" value={`${engagement.opens} opens · ${engagement.clicks} clicks · ${engagement.visits} visits`} />
                    </div>
                  </section>
                </div>
              )
            },
            {
              id: "conversation",
              label: "Conversation",
              content: <ConversationTab emails={thread.emails} latestEmailId={latestEmail?.id} />
            },
            {
              id: "composer",
              label: "Reply Composer",
              content: (
                <div id="reply-composer" className="space-y-4">
                  <section className="rounded-xl border border-line bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="font-bold">Reply</h2>
                        <p className="text-sm text-muted">Reply manually, generate an AI draft, or insert a template. Nothing sends automatically.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <HybridReplyActions threadId={thread.id} hasDraft={Boolean(latestDraft)} />
                      </div>
                    </div>
                  </section>
                  {latestDraft ? <DraftEditor draft={latestDraft} clientEmailConfidence={lead?.clientEmailConfidence} /> : <EmptyPanel title="No draft yet" detail="Click Reply Manually to write without AI, or Generate AI Draft to let AI prepare a draft." />}
                </div>
              )
            },
            {
              id: "timeline",
              label: "Timeline",
              content: <TimelineTab thread={thread} lead={lead} />
            },
            {
              id: "analytics",
              label: "Analytics",
              content: <AnalyticsTab engagement={engagement} lead={lead} sentEmails={thread.sentEmails} />
            },
            {
              id: "notes",
              label: "Notes",
              content: <EmptyPanel title="Internal notes coming soon." detail="A notes model is not available yet, so this tab is reserved for future team notes." />
            },
            {
              id: "attachments",
              label: "Attachments",
              content: <AttachmentsTab emails={thread.emails} latestDraft={latestDraft} />
            }
          ]}
        />

        <aside className="space-y-4 xl:sticky xl:top-[116px] xl:self-start">
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="font-bold">Quick Summary</h2>
            <div className="mt-3 space-y-2">
              <Info label="Client" value={clientName} />
              <Info label="Status" value={lead?.status.replaceAll("_", " ") || "No lead"} />
              <Info label="Owner" value={lead?.assignedUser || "Unassigned"} />
              <Info label="Score" value={scoreLabel} />
              <Info label="Last reply" value={<ClientDateTime value={latestReply} fallback="None" />} />
            </div>
          </section>
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="font-bold">Quick Actions</h2>
            <div className="mt-3 flex flex-col gap-2">
              <HybridReplyActions threadId={thread.id} hasDraft={Boolean(latestDraft)} compact />
              <Link href="/scheduled" className="btn-secondary inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold">Scheduled Emails</Link>
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function ConversationTab({ emails, latestEmailId }: { emails: any[]; latestEmailId?: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-bold">Conversation</h2>
        <p className="text-sm text-muted">Latest message is expanded. Repeated quoted blocks are hidden by default.</p>
      </div>
      <div className="divide-y divide-line">
        {emails.map((email) => {
          const body = splitQuotedText(email.textBody || email.snippet || "");
          return (
            <details key={email.id} open={email.id === latestEmailId} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-subtle">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={email.direction === "OUTBOUND" ? "green" : "blue"}>{email.direction === "OUTBOUND" ? "Sent" : "Received"}</Badge>
                    <span className="truncate font-semibold">{email.direction === "INBOUND" ? email.fromName || email.fromEmail : email.toEmails.join(", ")}</span>
                  </div>
                  <div className="mt-1 truncate text-sm text-muted">{email.subject}</div>
                </div>
                <div className="shrink-0 text-sm text-muted"><ClientDateTime value={email.sentAt} timeStyle="short" /></div>
              </summary>
              <div className="px-4 pb-4">
                <pre className="max-h-[420px] whitespace-pre-wrap rounded-lg border border-line bg-subtle p-4 font-sans text-sm leading-6 text-ink">{body.visible || "(No plain text body)"}</pre>
                {body.quoted ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-accent">Show quoted text</summary>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-white p-3 font-sans text-xs leading-5 text-muted">{body.quoted}</pre>
                  </details>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function TimelineTab({ thread, lead }: { thread: any; lead: any }) {
  const events = [
    lead ? { label: "Lead imported", date: lead.createdAt, detail: lead.email } : null,
    ...thread.drafts.map((draft: any) => ({ label: "Draft created", date: draft.createdAt, detail: draft.subject })),
    ...thread.sentEmails.map((email: any) => ({ label: "Sent email", date: email.sentAt, detail: email.subject })),
    ...thread.emails.filter((email: any) => email.direction === "INBOUND").map((email: any) => ({ label: "Client reply", date: email.sentAt, detail: email.subject })),
    ...thread.emails.filter((email: any) => email.direction === "OUTBOUND").map((email: any) => ({ label: "First reply / follow-up", date: email.sentAt, detail: email.subject })),
    lead?.proposalViews?.length ? { label: "Proposal viewed", date: lead.proposalViews[0].viewedAt, detail: `${lead.proposalViews.length} proposal view(s)` } : null
  ].filter(Boolean).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">Timeline</h2>
      <div className="mt-4 space-y-3">
        {events.map((event: any, index) => (
          <div key={`${event.label}-${index}`} className="flex gap-3 rounded-lg border border-line bg-subtle p-3">
            <div className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
            <div>
              <div className="text-sm font-bold">{event.label}</div>
              <div className="mt-1 text-sm text-muted"><ClientDateTime value={event.date} timeStyle="short" /> · {event.detail}</div>
            </div>
          </div>
        ))}
        {!events.length ? <div className="text-sm text-muted">No activity yet.</div> : null}
      </div>
    </section>
  );
}

function AnalyticsTab({ engagement, lead, sentEmails }: { engagement: ReturnType<typeof summarizeEngagement>; lead: any; sentEmails: any[] }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">Email Analytics</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Opens" value={String(engagement.opens)} />
        <Info label="Clicks" value={String(engagement.clicks)} />
        <Info label="Website visits" value={String(engagement.visits)} />
        <Info label="Engagement score" value={String(engagement.score)} />
        <Info label="Sent emails" value={String(sentEmails.length)} />
        <Info label="Last opened" value={<ClientDateTime value={engagement.lastOpenAt} fallback="None" timeStyle="short" />} />
        <Info label="Last clicked" value={<ClientDateTime value={engagement.lastClickedAt} fallback="None" timeStyle="short" />} />
        <Info label="Proposal views" value={String(lead?.proposalViews?.length || 0)} />
      </div>
    </section>
  );
}

function AttachmentsTab({ emails, latestDraft }: { emails: any[]; latestDraft: any }) {
  const attachments = [
    ...emails.flatMap((email) => attachmentList(email.attachmentMetadata).map((item) => ({ ...item, source: email.subject }))),
    ...attachmentList(latestDraft?.attachmentMetadata).map((item) => ({ ...item, source: latestDraft?.subject || "Draft" }))
  ];
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">Attachments</h2>
      <div className="mt-3 space-y-2">
        {attachments.map((item, index) => (
          <div key={`${item.name}-${index}`} className="rounded-lg border border-line bg-subtle p-3 text-sm">
            <div className="font-semibold">{item.name}</div>
            <div className="mt-1 text-muted">{item.source}{item.size ? ` · ${Math.ceil(item.size / 1024)} KB` : ""}</div>
          </div>
        ))}
        {!attachments.length ? <div className="rounded-lg border border-dashed border-line bg-subtle p-4 text-sm text-muted">No attachments.</div> : null}
      </div>
    </section>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="rounded-xl border border-dashed border-line bg-white p-6 text-sm text-muted">
      <div className="font-bold text-ink">{title}</div>
      <p className="mt-1">{detail}</p>
    </section>
  );
}

function Badge({ children, tone = "slate" }: { children: string; tone?: "slate" | "green" | "blue" }) {
  const styles = {
    slate: "border-line bg-subtle text-muted",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700"
  };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function latestInbound(emails: any[]) {
  return [...emails].reverse().find((email) => email.direction === "INBOUND");
}

function latestOutbound(emails: any[]) {
  return [...emails].reverse().find((email) => email.direction === "OUTBOUND");
}

function summarizeEngagement(sentEmails: any[]) {
  return sentEmails.reduce(
    (total, sentEmail) => {
      const engagement = sentEmail.engagement;
      if (!engagement) return total;
      return {
        opens: total.opens + engagement.openCount,
        clicks: total.clicks + engagement.clickedLinks,
        visits: total.visits + engagement.websiteVisits,
        score: total.score + engagement.engagementScore,
        lastOpenAt: maxDate(total.lastOpenAt, engagement.lastOpenAt),
        lastClickedAt: maxDate(total.lastClickedAt, engagement.lastClickedAt)
      };
    },
    { opens: 0, clicks: 0, visits: 0, score: 0, lastOpenAt: null as Date | null, lastClickedAt: null as Date | null }
  );
}

function maxDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function splitQuotedText(body: string) {
  const quoteLineIndex = body.search(/\n[>]{2,}.+/);
  const markers = [
    quoteLineIndex > 80 ? quoteLineIndex : -1,
    body.indexOf("\nOn "),
    body.indexOf("\nFrom:"),
    body.indexOf("\nSent:"),
    body.indexOf("\n-----Original Message-----")
  ].filter((index) => index > 80);
  if (!markers.length) return { visible: body.trim(), quoted: "" };
  const splitAt = Math.min(...markers);
  return { visible: body.slice(0, splitAt).trim(), quoted: body.slice(splitAt).trim() };
}

function attachmentList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    name: String(item?.name || item?.filename || "Attachment"),
    size: Number(item?.size || 0)
  }));
}

function withProtocol(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
