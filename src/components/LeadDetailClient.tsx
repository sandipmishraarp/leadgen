"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AIDraftReadyPanel } from "@/components/AIDraftReadyPanel";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { ClientBrainCard } from "@/components/ClientBrainCard";
import { DraftEditor } from "@/components/DraftEditor";
import { GenerateDraftButton } from "@/components/GenerateDraftButton";
import { GenerateFirstReplyButton } from "@/components/GenerateFirstReplyButton";
import { HybridReplyActions } from "@/components/HybridReplyActions";
import { LeadDetailTabs } from "@/components/LeadDetailTabs";
import { LeadIntelligenceHeader } from "@/components/LeadIntelligenceHeader";
import { LeadQualificationCard } from "@/components/LeadQualificationCard";
import { LeadReviewActions } from "@/components/LeadReviewActions";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { WhatsAppLeadPanel } from "@/components/WhatsAppLeadPanel";

export function LeadDetailClient({ lead, intelligence, activeSalesEmail, contactBlock }: { lead: any; intelligence: any; activeSalesEmail: string; contactBlock?: any }) {
  const threads = Array.isArray(lead?.threads) ? lead.threads : [];
  const leadIntakes = Array.isArray(lead?.leadIntakes) ? lead.leadIntakes : [];
  const websiteVisits = Array.isArray(lead?.websiteVisits) ? lead.websiteVisits : [];
  const proposalViews = Array.isArray(lead?.proposalViews) ? lead.proposalViews : [];

  const timeline = threads
    .flatMap((thread: any) => (Array.isArray(thread.emails) ? thread.emails : []).map((email: any) => ({ ...email, thread })))
    .sort((a: any, b: any) => timeValue(a.sentAt) - timeValue(b.sentAt));
  const latestThread = threads[0];
  const latestInboundEmail = [...timeline].reverse().find((email) => email.direction === "INBOUND");
  const drafts = threads.flatMap((thread: any) => Array.isArray(thread.drafts) ? thread.drafts : []);
  const latestDraft = [...drafts]
    .filter((draft) => draft.isCurrent && draft.status !== "SENT" && draft.status !== "DISCARDED")
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))[0]
    || [...drafts].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))[0];
  const draftIsStale = Boolean(
    latestDraft
    && latestInboundEmail
    && (!latestDraft.basedOnEmailDate || timeValue(latestDraft.basedOnEmailDate) < timeValue(latestInboundEmail.sentAt))
  );
  const latestIntake = leadIntakes[0];
  const ageClass = leadAgeClassification(latestIntake?.receivedAt || latestIntake?.importedAt || lead.createdAt);
  const actionType = extractActionType(lead.notes) || (ageClass === "REVIVAL_LEAD" || ageClass === "DORMANT_LEAD" ? "REVIVAL" : "FIRST_REPLY");
  const sourceMailbox = latestIntake?.accountEmail || latestIntake?.fromEmail || "Not set";
  const currentOwner = lead.assignedUser || "Unassigned";
  const scoreLabel = lead.qualification ? `${lead.qualification.score}/100 · ${lead.qualification.classification.replaceAll("_", " ")}` : "Not scored";
  const nextAction = lead.clientBrain?.nextBestAction || lead.clientBrain?.recommendedNextStep || lead.qualification?.recommendedAction || "Review the lead and prepare a concise next-step email.";
  const stageTimeline = buildStageTimeline({ ...lead, threads, leadIntakes, websiteVisits, proposalViews }, latestIntake);
  const engagementSummary = buildEngagementSummary(lead, threads);

  return (
    <AppShell>
      <div className="sticky top-0 z-30 -mx-2 mb-4 rounded-2xl border border-line bg-white/95 px-4 py-3 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold">{lead.name || lead.email}</h1>
              <Badge>{lead.status.replaceAll("_", " ")}</Badge>
              {contactBlock?.blocked ? <Badge tone="red">{contactBlock.label || "Do Not Contact"}</Badge> : null}
              {(ageClass === "REVIVAL_LEAD" || ageClass === "DORMANT_LEAD") ? <Badge tone="amber">{ageClass.replaceAll("_", " ")}</Badge> : null}
              <Badge tone={lead.qualification?.classification === "HOT" ? "green" : lead.qualification?.classification === "LOW_QUALITY" ? "red" : "slate"}>{scoreLabel}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span>{lead.company || "Company not set"}</span>
              <span>{lead.email}</span>
              {lead.website ? <a className="text-accent hover:underline" href={withProtocol(lead.website)} target="_blank" rel="noreferrer">{lead.website}</a> : <span>Website not set</span>}
              <span>Owner: {currentOwner}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LeadReviewActions leadId={lead.id} />
            {latestThread ? (
              <HybridReplyActions threadId={latestThread.id} hasDraft={Boolean(latestDraft)} blocked={Boolean(contactBlock?.blocked)} />
            ) : contactBlock?.blocked ? <BlockedAction reason={contactBlock.reason} /> : <GenerateFirstReplyButton leadId={lead.id} />}
            <LeadStatusSelect leadId={lead.id} status={lead.status} />
          </div>
        </div>
      </div>
      {contactBlock?.blocked ? (
        <section className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-bold">Do Not Contact: {contactBlock.label || "Blocked"}</div>
          <div className="mt-1">{contactBlock.reason || "This lead has a do-not-contact signal."}</div>
          {contactBlock.sourceSubject || contactBlock.sourceDate ? (
            <div className="mt-1 text-xs">
              Source: {contactBlock.sourceSubject || "message"} {contactBlock.sourceDate ? <>on <ClientDateTime value={contactBlock.sourceDate} /></> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <LeadDetailTabs
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "conversation", label: "Conversation" },
            { id: "drafts", label: "Drafts & Composer" },
            { id: "brain", label: "Client Brain" },
            { id: "qualification", label: "Qualification" },
            { id: "source", label: "Source / Raw Email" },
            { id: "whatsapp", label: "WhatsApp" },
            { id: "activity", label: "Activity" }
          ]}
        >
          <div className="space-y-4">
            <LeadIntelligenceHeader
              leadId={lead.id}
              intelligence={intelligence}
              draft={latestDraft || null}
              clientEmail={lead.email}
              fromEmail={activeSalesEmail}
            />
            <ForwardedLeadContextCard latestIntake={latestIntake} />
            <div className="grid gap-4 lg:grid-cols-2">
              <CompactQualification qualification={lead.qualification} leadId={lead.id} />
              <CompactBrain clientBrain={lead.clientBrain} leadId={lead.id} />
            </div>
            <EngagementCard summary={engagementSummary} />
            <section className="rounded-xl border border-line bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-bold">Key Lead Details</h2>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">Overview</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Info label="Client email" value={lead.email} />
                <Info label="Email confidence" value={lead.clientEmailConfidence ? `${lead.clientEmailConfidence}%` : "Not set"} />
                <Info label="Service" value={lead.service || "Not set"} />
                <Info label="Country" value={lead.country || "Not set"} />
                <Info label="Phone" value={lead.phone || "Not set"} />
                <Info label="Source provider" value={latestIntake?.sourceProviderName || latestIntake?.detectedProviderName || "Not set"} />
              </div>
            </section>
            <MiniTimeline stages={stageTimeline} />
          </div>
          <ConversationTimeline timeline={timeline} latestEmailId={timeline.at(-1)?.id} />
          <div id="drafts-composer" className="space-y-4">
            <section className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">Reply</h2>
                  <p className="text-sm text-muted">Choose manual writing, AI draft, or a template. Review is always required before sending.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {latestThread ? (
                    <HybridReplyActions threadId={latestThread.id} hasDraft={Boolean(latestDraft)} blocked={Boolean(contactBlock?.blocked)} />
                  ) : contactBlock?.blocked ? <BlockedAction reason={contactBlock.reason} /> : <GenerateFirstReplyButton leadId={lead.id} />}
                </div>
              </div>
            </section>
            {latestDraft ? (
              <>
                <AIDraftReadyPanel hasClientBrain={Boolean(lead.clientBrain)} hasQualification={Boolean(lead.qualification)} />
                {draftIsStale ? (
                  <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="font-bold">This draft was created before the latest client reply.</div>
                    <p className="mt-1">Generate a fresh draft so the reply directly responds to the newest client message.</p>
                    <div className="mt-3">
                      {latestInboundEmail ? <GenerateDraftButton threadId={latestInboundEmail.threadId} draftType="REPLY" label="Generate Fresh Draft" /> : null}
                    </div>
                  </section>
                ) : null}
                <DraftEditor
                  key={latestDraft.id}
                  draft={latestDraft}
                  fromEmail={activeSalesEmail}
                  latestClientMessageAt={latestInboundEmail?.sentAt || null}
                  isStale={draftIsStale}
                  clientEmailConfidence={lead.clientEmailConfidence}
                  clientTimezone={intelligence.detectedTimezone}
                  nextBestSendTime={intelligence.nextBestSendTime}
                  nextBestSendTimeIso={intelligence.nextBestSendTimeIso}
                  businessHoursWarning={!intelligence.isBusinessHours ? `${intelligence.businessHoursStatus}. Recommended: ${intelligence.sendNowRecommendation} (${intelligence.nextBestSendTime}).` : null}
                />
              </>
            ) : (
              <EmptyPanel title="No draft yet" detail="Generate the first reply or follow-up draft to open the composer here." />
            )}
          </div>
          <ClientBrainCard leadId={lead.id} clientBrain={lead.clientBrain} />
          <LeadQualificationCard leadId={lead.id} qualification={lead.qualification} />
          <SourcePanel lead={lead} latestIntake={latestIntake} sourceMailbox={sourceMailbox} />
          <WhatsAppLeadPanel lead={lead} contactBlock={contactBlock} />
          <ActivityPanel stages={stageTimeline} lead={lead} timeline={timeline} />
        </LeadDetailTabs>

        <aside className="space-y-4 xl:sticky xl:top-[116px] xl:self-start">
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="font-bold">Next Action</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{nextAction}</p>
            <div className="mt-4 space-y-2 text-sm">
              <Info label="Assigned owner" value={currentOwner} />
              <Info label="Sales account" value={lead.assignedEmailAccount || "Not assigned"} />
              <Info label="Recommended action" value={actionType === "REVIVAL" ? "Fresh reconnect recommended" : actionType.replaceAll("_", " ")} />
              <Info label="Follow-up date" value={<ClientDateTime value={lead.nextFollowUpAt} fallback="Not set" />} />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {latestThread ? (
                <HybridReplyActions threadId={latestThread.id} hasDraft={Boolean(latestDraft)} blocked={Boolean(contactBlock?.blocked)} compact />
              ) : contactBlock?.blocked ? <BlockedAction reason={contactBlock.reason} /> : <GenerateFirstReplyButton leadId={lead.id} />}
              <Link href="/scheduled" className="btn-secondary inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold">Scheduled Emails</Link>
            </div>
          </section>
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="font-bold">Mailbox Context</h2>
            <div className="mt-3 space-y-2 text-sm">
              <Info label="Source mailbox" value={sourceMailbox} />
              <Info label="Current mailbox" value={lead.currentMailbox || sourceMailbox} />
              <Info label="Source folder" value={latestIntake?.sourceFolderPath || latestIntake?.sourceFolder || "Not set"} />
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function BlockedAction({ reason }: { reason?: string }) {
  return (
    <span title={reason || "Lead is marked Do Not Contact"} className="inline-flex h-10 items-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700">
      Blocked
    </span>
  );
}

function CompactQualification({ qualification, leadId }: { qualification: any; leadId: string }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-bold">Lead Qualification</h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Snapshot</span>
      </div>
      {qualification ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <ScoreCircle score={qualification.score} />
          <Info label="Win probability" value={`${qualification.winProbability}%`} />
          <Info label="Deal estimate" value={qualification.dealSizeEstimate ? `$${qualification.dealSizeEstimate.toLocaleString()}` : "Not enough data"} />
          <div className="sm:col-span-3 rounded-lg border border-line bg-subtle p-3 text-sm text-muted">
            {qualification.recommendedAction || "Review this lead and choose the next human-approved action."}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-subtle p-4 text-sm text-muted">
          No score yet. Open Qualification and click Recalculate Score.
        </div>
      )}
    </section>
  );
}

function CompactBrain({ clientBrain, leadId }: { clientBrain: any; leadId: string }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-bold">AI Client Brain</h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Summary</span>
      </div>
      {clientBrain ? (
        <div className="space-y-3">
          <p className="line-clamp-4 rounded-lg border border-line bg-subtle p-3 text-sm leading-6 text-muted">{clientBrain.summary || "No summary captured yet."}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Service" value={clientBrain.interestedService || "Not set"} />
            <Info label="Decision stage" value={clientBrain.decisionStage || "Not set"} />
            <Info label="Tone" value={clientBrain.preferredTone || "Not set"} />
            <Info label="Next step" value={clientBrain.nextBestAction || clientBrain.recommendedNextStep || "Not set"} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-subtle p-4 text-sm text-muted">
          No client brain yet. Open Client Brain and refresh it from conversation history.
        </div>
      )}
    </section>
  );
}

function EngagementCard({ summary }: { summary: any }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-bold">Engagement</h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Tracking Gateway</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Open count" value={String(summary.openCount)} />
        <Info label="Click count" value={String(summary.clickCount)} />
        <Info label="Emails sent" value={String(summary.emailsSent)} />
        <Info label="Unique opens" value={String(summary.uniqueOpens)} />
        <Info label="First open" value={<ClientDateTime value={summary.firstOpenAt} fallback="No opens" timeStyle="short" />} />
        <Info label="Last open" value={<ClientDateTime value={summary.lastOpenAt} fallback="No opens" timeStyle="short" />} />
        <Info label="First click" value={<ClientDateTime value={summary.firstClickAt} fallback="No clicks" timeStyle="short" />} />
        <Info label="Last click" value={<ClientDateTime value={summary.lastClickAt} fallback="No clicks" timeStyle="short" />} />
        <Info label="Latest device" value={summary.latestDevice || "Unknown"} />
        <Info label="Latest browser" value={summary.latestBrowser || "Unknown"} />
        <Info label="Latest IP" value={summary.latestIp || "Unknown"} />
        <Info label="Latest activity" value={<ClientDateTime value={summary.latestActivityAt} fallback="No activity" timeStyle="short" />} />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 bg-subtle px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <span>Email</span>
          <span>Opens</span>
          <span>Clicks</span>
          <span>Last activity</span>
        </div>
        {summary.emailRows.length ? summary.emailRows.map((email: any) => (
          <div key={email.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-t border-line px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-semibold">{email.subject || "Sent email"}</div>
              <div className="text-xs text-muted">
                Sent <ClientDateTime value={email.sentAt} fallback="Unknown date" timeStyle="short" />
              </div>
            </div>
            <span className="rounded-full bg-subtle px-2 py-1 text-xs font-semibold">{email.openCount ? `${email.openCount}x` : "Not opened"}</span>
            <span className="rounded-full bg-subtle px-2 py-1 text-xs font-semibold">{email.clickCount ? `${email.clickCount}x` : "No clicks"}</span>
            <span className="text-xs text-muted"><ClientDateTime value={email.lastActivityAt} fallback="None" timeStyle="short" /></span>
          </div>
        )) : (
          <div className="border-t border-line px-3 py-4 text-sm text-muted">No sent email engagement yet.</div>
        )}
      </div>
    </section>
  );
}

function ForwardedLeadContextCard({ latestIntake }: { latestIntake: any }) {
  if (!latestIntake || !latestIntake.fullForwardedChain && !latestIntake.latestClientMessage && !latestIntake.detectedIntent) return null;
  const requestedItems = Array.isArray(latestIntake.requestedItems) ? latestIntake.requestedItems : [];
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-blue-950">Forwarded Lead Context</h2>
          <p className="text-sm text-blue-800">Original client conversation detected from provider-forwarded email.</p>
        </div>
        <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-700">
          {latestIntake.detectedIntent || "UNKNOWN"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Info label="Forwarded by" value={latestIntake.forwardedBy || latestIntake.detectedProviderName || latestIntake.fromEmail || "Not set"} />
        <Info label="Original client" value={[latestIntake.originalClientName || latestIntake.extractedName, latestIntake.originalClientEmail || latestIntake.extractedClientEmail].filter(Boolean).join(" · ") || "Not set"} />
        <Info label="Original subject" value={latestIntake.originalSubject || latestIntake.subject || "Not set"} />
        <Info label="Provider email" value={latestIntake.providerEmail || latestIntake.leadGeneratorEmail || "Not set"} />
        <Info label="Recommended reply" value={latestIntake.recommendedReplyType || "Use forwarded conversation context."} />
        <Info label="Requested items" value={requestedItems.length ? requestedItems.join(", ") : "None detected"} />
      </div>
      <div className="mt-4 rounded-lg border border-blue-100 bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Latest client message</div>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
          {latestIntake.latestClientMessage || latestIntake.originalClientMessage || "No client-authored message detected."}
        </pre>
      </div>
    </section>
  );
}

function ConversationTimeline({ timeline, latestEmailId }: { timeline: any[]; latestEmailId?: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-bold">Conversation</h2>
        <p className="text-sm text-muted">Latest email is expanded. Older quoted text stays hidden until needed.</p>
      </div>
      <div className="divide-y divide-line">
        {timeline.map((email) => {
          const parts = splitQuotedText(email.textBody || email.snippet || "");
          const isLatest = email.id === latestEmailId;
          return (
            <details key={email.id} open={isLatest} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-subtle">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={email.direction === "OUTBOUND" ? "green" : "blue"}>{email.direction === "OUTBOUND" ? "Sent" : "Received"}</Badge>
                    <span className="truncate font-semibold">{email.direction === "INBOUND" ? email.fromEmail : email.toEmails.join(", ")}</span>
                  </div>
                  <div className="mt-1 truncate text-sm text-muted">{email.subject}</div>
                </div>
                <div className="shrink-0 text-sm text-muted"><ClientDateTime value={email.sentAt} timeStyle="short" /></div>
              </summary>
              <div className="px-4 pb-4">
                <div className="rounded-lg border border-line bg-subtle p-4 text-sm leading-6 text-ink">
                  <pre className="max-h-[420px] whitespace-pre-wrap font-sans">{parts.visible || "No body stored."}</pre>
                  {parts.quoted ? (
                    <details className="mt-3 border-t border-line pt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-accent">Show quoted text</summary>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 font-sans text-xs leading-5 text-muted">{parts.quoted}</pre>
                    </details>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
        {!timeline.length ? <div className="px-4 py-8 text-sm text-muted">No conversation yet. Generate the first reply draft from the Drafts & Composer tab.</div> : null}
      </div>
    </section>
  );
}

function SourcePanel({ lead, latestIntake, sourceMailbox }: { lead: any; latestIntake: any; sourceMailbox: string }) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">Imported Source</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Info label="Source mailbox" value={sourceMailbox} />
          <Info label="Source folder" value={latestIntake?.sourceFolderPath || latestIntake?.sourceFolder || "Not set"} />
          <Info label="Provider" value={latestIntake?.sourceProviderName || latestIntake?.detectedProviderName || "Not set"} />
          <Info label="Extracted email" value={latestIntake?.extractedClientEmail || lead.email} />
          <Info label="Confidence" value={latestIntake?.extractionConfidence ? `${latestIntake.extractionConfidence}%` : lead.clientEmailConfidence ? `${lead.clientEmailConfidence}%` : "Not set"} />
          <Info label="Reason" value={latestIntake?.extractionReason || lead.clientEmailReason || "Not set"} />
        </div>
      </section>
      {latestIntake ? (
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="font-bold">Lead Source Message</h2>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-4 font-sans text-sm leading-6">
            {latestIntake.latestClientMessage || latestIntake.originalClientMessage || latestIntake.forwardedClientMessage || "No original client message found."}
          </pre>
          {latestIntake.fullForwardedChain ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-accent">Show full forwarded chain</summary>
              <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-4 font-sans text-xs leading-5 text-muted">
                {latestIntake.fullForwardedChain}
              </pre>
            </details>
          ) : null}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-accent">Show full raw imported email</summary>
            <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-4 font-sans text-xs leading-5 text-muted">
              {latestIntake.rawText || latestIntake.rawEmail || "No raw email stored."}
            </pre>
          </details>
        </section>
      ) : (
        <EmptyPanel title="No imported source found" detail="This lead does not have a linked lead intake record." />
      )}
      {Array.isArray(lead.leadIntakes) && lead.leadIntakes.length ? (
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="font-bold">All Intake Records</h2>
          <div className="mt-3 space-y-2">
            {lead.leadIntakes.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-line bg-subtle p-3 text-sm">
                <div className="font-semibold">{item.extractedClientEmail || lead.email}</div>
                <div className="mt-1 text-muted">{item.sourceFolderPath || item.sourceFolder || "Unknown folder"} · Confidence {item.extractionConfidence || 0}%</div>
                {Array.isArray(item.rejectedEmails) && item.rejectedEmails.length ? <div className="mt-1 text-xs text-muted">Rejected: {item.rejectedEmails.join(", ")}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ActivityPanel({ stages, lead, timeline }: { stages: any[]; lead: any; timeline: any[] }) {
  const websiteVisits = Array.isArray(lead.websiteVisits) ? lead.websiteVisits : [];
  const proposalViews = Array.isArray(lead.proposalViews) ? lead.proposalViews : [];
  return (
    <div className="space-y-4">
      <MiniTimeline stages={stages} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">Recent Signals</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Info label="Messages" value={String(timeline.length)} />
          <Info label="Website visits" value={String(websiteVisits.length)} />
          <Info label="Proposal views" value={String(proposalViews.length)} />
          <Info label="Last updated" value={<ClientDateTime value={lead.updatedAt} timeStyle="short" />} />
        </div>
      </section>
    </div>
  );
}

function MiniTimeline({ stages }: { stages: any[] }) {
  const safeStages = Array.isArray(stages) ? stages : [];
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">Timeline Summary</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {safeStages.map((stage) => (
          <div key={stage.label} className={`rounded-lg border p-3 ${stage.done ? "border-accent bg-subtle" : "border-line bg-white"}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{stage.label}</div>
            <div className="mt-2 text-sm font-bold">{stage.done ? "Done" : "Pending"}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{stage.detail}</div>
          </div>
        ))}
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

function ScoreCircle({ score }: { score: number }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Score</div>
      <div className="mt-1 text-2xl font-bold">{score}/100</div>
    </div>
  );
}

function Badge({ children, tone = "slate" }: { children: string; tone?: "slate" | "green" | "blue" | "red" | "amber" }) {
  const styles = {
    slate: "border-line bg-subtle text-muted",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700"
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

function splitQuotedText(body: string) {
  const markers = [
    "\nOn ",
    "\nFrom:",
    "\nSent:",
    "\n-----Original Message-----",
    "\n> "
  ];
  const indexes = markers.map((marker) => body.indexOf(marker)).filter((index) => index > 80);
  if (!indexes.length) return { visible: body.trim(), quoted: "" };
  const splitAt = Math.min(...indexes);
  return {
    visible: body.slice(0, splitAt).trim(),
    quoted: body.slice(splitAt).trim()
  };
}

function timeValue(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function extractActionType(notes?: string | null) {
  return notes?.match(/\[AI_SALES_ACTION_TYPE:(FIRST_REPLY|FOLLOW_UP|REVIVAL)\]/)?.[1] || null;
}

function leadAgeClassification(value: string | Date) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 30) return "NEW_LEAD";
  if (days <= 180) return "OLD_LEAD";
  if (days <= 730) return "DORMANT_LEAD";
  return "REVIVAL_LEAD";
}

function buildStageTimeline(lead: any, latestIntake: any) {
  const threads = Array.isArray(lead.threads) ? lead.threads : [];
  const proposalViews = Array.isArray(lead.proposalViews) ? lead.proposalViews : [];
  const hasOutbound = Boolean(lead.lastOutboundAt || threads.some((thread: any) => (Array.isArray(thread.emails) ? thread.emails : []).some((email: any) => email.direction === "OUTBOUND")));
  const hasReply = Boolean(lead.lastInboundAt || lead.status === "REPLIED");
  return [
    { label: "Lead Imported", done: Boolean(latestIntake), detail: latestIntake?.receivedAt ? <ClientDateTime value={latestIntake.receivedAt} timeStyle="short" /> : "Waiting for import" },
    { label: "Approved", done: ["APPROVED", "CONTACTED", "DRAFT_CREATED", "REPLIED", "PROPOSAL_SENT", "WON", "LOST"].includes(lead.status), detail: lead.status.replaceAll("_", " ") },
    { label: "Assigned", done: Boolean(lead.assignedEmailAccount), detail: lead.assignedEmailAccount || "No owner yet" },
    { label: "First Reply", done: hasOutbound, detail: lead.lastOutboundAt ? <ClientDateTime value={lead.lastOutboundAt} timeStyle="short" /> : "Not sent" },
    { label: "Client Reply", done: hasReply, detail: lead.lastInboundAt ? <ClientDateTime value={lead.lastInboundAt} timeStyle="short" /> : "No reply yet" },
    { label: "Proposal", done: lead.status === "PROPOSAL_SENT" || proposalViews.length > 0, detail: proposalViews.length ? `${proposalViews.length} view(s)` : "Not sent" },
    { label: "Won/Lost", done: lead.status === "WON" || lead.status === "LOST", detail: lead.status === "WON" || lead.status === "LOST" ? lead.status : "Open" }
  ];
}

function buildEngagementSummary(lead: any, threads: any[]) {
  const sentEmails = threads.flatMap((thread: any) => Array.isArray(thread.sentEmails) ? thread.sentEmails : []);
  const engagements = sentEmails.map((sentEmail: any) => sentEmail.engagement).filter(Boolean);
  const activityLogs = Array.isArray(lead.activityLogs) ? lead.activityLogs : [];
  const latestTrackingLog = activityLogs.find((log: any) =>
    log?.metadata?.latestDevice || log?.metadata?.latestBrowser || log?.metadata?.ipAddress
  );
  const emailRows = sentEmails.map((sentEmail: any) => {
    const engagement = sentEmail.engagement || {};
    const lastActivityAt = maxDate([engagement.lastOpenAt, engagement.lastClickedAt, sentEmail.sentAt]);
    return {
      id: sentEmail.id,
      subject: sentEmail.subject,
      sentAt: sentEmail.sentAt,
      openCount: Number(engagement.openCount || 0),
      clickCount: Number(engagement.clickedLinks || 0),
      firstOpenAt: engagement.firstOpenAt || null,
      lastOpenAt: engagement.lastOpenAt || null,
      firstClickAt: engagement.firstClickedAt || engagement.lastClickedAt || null,
      lastClickAt: engagement.lastClickedAt || null,
      lastActivityAt
    };
  }).sort((a: any, b: any) => timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt));

  return {
    emailsSent: sentEmails.length,
    openCount: engagements.reduce((sum: number, engagement: any) => sum + Number(engagement.openCount || 0), 0),
    uniqueOpens: engagements.filter((engagement: any) => Number(engagement.openCount || 0) > 0).length,
    clickCount: engagements.reduce((sum: number, engagement: any) => sum + Number(engagement.clickedLinks || 0), 0),
    uniqueClicks: engagements.filter((engagement: any) => Number(engagement.clickedLinks || 0) > 0).length,
    firstOpenAt: minDate(engagements.map((engagement: any) => engagement.firstOpenAt)),
    lastOpenAt: maxDate(engagements.map((engagement: any) => engagement.lastOpenAt)),
    firstClickAt: minDate(engagements.map((engagement: any) => engagement.firstClickedAt || engagement.lastClickedAt)),
    lastClickAt: maxDate(engagements.map((engagement: any) => engagement.lastClickedAt)),
    latestActivityAt: maxDate(activityLogs.map((log: any) => log.createdAt)),
    latestDevice: latestTrackingLog?.metadata?.latestDevice || null,
    latestBrowser: latestTrackingLog?.metadata?.latestBrowser || null,
    latestIp: latestTrackingLog?.metadata?.ipAddress || null,
    emailRows
  };
}

function minDate(values: Array<string | Date | null | undefined>) {
  const dates = values.filter(Boolean).map((value) => new Date(value as string | Date)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(values: Array<string | Date | null | undefined>) {
  const dates = values.filter(Boolean).map((value) => new Date(value as string | Date)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function withProtocol(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function pickSalesEmail(...values: Array<string | null | undefined>) {
  const candidate = values
    .map((value) => decodeURIComponent(value || "").trim().toLowerCase())
    .find((value) => value && !value.startsWith("lead@"));
  return candidate || "abhay@aresourcepool.com";
}
