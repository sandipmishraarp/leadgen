"use client";

import Link from "next/link";
import type React from "react";
import { useState } from "react";
import { ClientDateTime } from "@/components/ClientDateTime";
import { LeadIntakeActions } from "@/components/LeadIntakeActions";

type LeadIntakeRow = Record<string, any>;
type ContactBlock = { blocked?: boolean; label?: string; reason?: string; code?: string } | null;

export function LeadIntakeTable({
  items,
  blocksByItemId
}: {
  items: LeadIntakeRow[];
  blocksByItemId: Record<string, ContactBlock>;
}) {
  const [selected, setSelected] = useState<LeadIntakeRow | null>(null);
  const [detail, setDetail] = useState<LeadIntakeRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openDetail(item: LeadIntakeRow) {
    setSelected(item);
    setDetail(null);
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/lead-intake/${item.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load lead details");
      setDetail(data.item || item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load lead details");
      setDetail(item);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="hidden grid-cols-[48px_1.35fr_1fr_0.8fr_0.9fr_150px_120px_150px] gap-3 border-b border-line bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
          <span>Select</span>
          <span>Lead</span>
          <span>Company / Website</span>
          <span>Service</span>
          <span>Provider</span>
          <span>Received</span>
          <span>Status</span>
          <span>Action</span>
        </div>
        <div className="divide-y divide-line">
          {items.map((item) => {
            const block = blocksByItemId[item.id];
            const isWarm = isForwardedWarmReply(item);
            return (
              <article
                key={item.id}
                className={`grid gap-3 px-4 py-3 text-sm lg:grid-cols-[48px_1.35fr_1fr_0.8fr_0.9fr_150px_120px_150px] lg:items-center ${
                  block?.blocked ? "bg-red-50/70" : ""
                }`}
              >
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input type="checkbox" name="selectedLeadIntake" value={item.id} className="h-4 w-4 rounded border-line" />
                  <span className="lg:hidden">Select</span>
                </label>
                <div className="min-w-0">
                  <button type="button" onClick={() => openDetail(item)} className="block max-w-full truncate text-left font-semibold text-slate-950 hover:text-accent">
                    {item.originalClientName || item.extractedName || item.extractedCompany || item.subject || "Unknown lead"}
                  </button>
                  <div className="mt-0.5 truncate text-slate-500">{cleanEmail(item.originalClientEmail || item.extractedClientEmail || "") || "Client email not confirmed"}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge>{leadAgeClassification(item.receivedAt || item.importedAt).replaceAll("_", " ")}</Badge>
                    {isWarm ? <Badge tone="blue">Warm reply</Badge> : null}
                    {item.needsManualConfirmation ? <Badge tone="amber">Needs confirmation</Badge> : null}
                    {isSandipReviewPending(item) ? <Badge tone="amber">Not Approved - Review</Badge> : null}
                    {block?.blocked ? <Badge tone="red">{block.label || "Do Not Contact"}</Badge> : null}
                  </div>
                </div>
                <div className="min-w-0 text-slate-600">
                  <div className="truncate font-medium">{item.originalCompany || item.extractedCompany || "Company not found"}</div>
                  <div className="truncate text-xs text-slate-500">{item.originalWebsite || item.extractedWebsite || "Website not found"}</div>
                </div>
                <div className="truncate text-slate-600">{item.extractedService || "Not found"}</div>
                <div className="min-w-0 text-slate-600">
                  <div className="truncate">{item.sourceProviderName || item.detectedProviderName || item.forwardedBy || "Unknown"}</div>
                  <div className="truncate text-xs text-slate-500">{item.providerEmail || item.leadGeneratorEmail || item.fromEmail || ""}</div>
                </div>
                <div className="text-xs text-slate-500">
                  <ClientDateTime value={item.receivedAt || item.importedAt} timeStyle="short" />
                </div>
                <div className="text-xs font-semibold">{String(item.status || "").replaceAll("_", " ")}</div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => openDetail(item)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white">
                    {isWarm ? "Review Reply" : "Review"}
                  </button>
                  {item.lead?.id ? (
                    <Link href={`/leads/${item.lead.id}`} className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-slate-600">
                      Open
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!items.length ? <div className="px-5 py-8 text-sm text-slate-500">No leads found for this mailbox.</div> : null}
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
          <button type="button" aria-label="Close lead review" className="absolute inset-0 cursor-default" onClick={() => setSelected(null)} />
          <aside className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lead review</div>
                <h2 className="mt-1 text-lg font-bold">{selected.originalClientName || selected.extractedName || selected.subject || "Lead details"}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-md border border-line px-3 py-1 text-sm font-semibold text-slate-600">
                Close
              </button>
            </div>

            {loading ? <div className="rounded-lg border border-line bg-slate-50 p-4 text-sm text-slate-500">Loading lead details...</div> : null}
            {error ? <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
            {detail ? <LeadIntakeDetail item={detail} block={blocksByItemId[selected.id]} /> : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}

function LeadIntakeDetail({ item, block }: { item: LeadIntakeRow; block: ContactBlock }) {
  const isWarm = isForwardedWarmReply(item);
  const conversationStatus = isWarm ? "Warm Reply" : item.extractedClientEmail || item.originalClientEmail ? "Fresh Lead" : "Unknown";
  return (
    <div className="space-y-4">
      {block?.blocked ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-bold">{block.label || "Do Not Contact"}</div>
          <div>{block.reason || "Safety guard detected a contact block."}</div>
        </div>
      ) : null}

      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge tone={isWarm ? "blue" : "slate"}>{conversationStatus}</Badge>
          <Badge tone={approvalStatusTone(item.status)}>{approvalStatus(item.status)}</Badge>
          {isSandipReviewPending(item) ? <Badge tone="amber">Not Approved - Sandip Review</Badge> : null}
          {item.needsManualConfirmation ? <Badge tone="amber">Needs confirmation</Badge> : null}
        </div>
        <Info label="Actual Client Name" value={item.originalClientName || item.extractedName} />
        <Info label="Actual Client Email" value={cleanEmail(item.originalClientEmail || item.extractedClientEmail || "")} />
        <Info label="Company" value={item.originalCompany || item.extractedCompany} />
        <Info label="Website" value={item.originalWebsite || item.extractedWebsite} />
        <Info label="Country" value={item.extractedCountry} />
        <Info label="Service" value={item.extractedService} />
        <Info label="Provider Sender" value={item.providerEmail || item.leadGeneratorEmail || item.fromEmail} />
        <Info label="Original Subject" value={item.originalSubject || item.subject} />
        <Info label="Detected Intent" value={item.detectedIntent?.replaceAll("_", " ")} />
        {isSandipReviewPending(item) ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="font-bold">Not Approved - Sandip Review</div>
            <Info label="Reviewer" value={item.reviewerEmail || item.fromEmail} />
            <div className="text-xs text-amber-800">
              Date: <ClientDateTime value={item.reviewerCommentAt || item.receivedAt} timeStyle="short" />
            </div>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-5">{item.reviewerComment || item.rawText || "No reviewer comment available."}</pre>
          </div>
        ) : null}
        <div className="mt-3 rounded-md border border-blue-100 bg-white px-3 py-2 text-sm">
          <span className="font-semibold">Suggested action: </span>
          {suggestedAction(item)}
        </div>
      </section>

      {item.needsManualConfirmation ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">Manual confirmation reason</div>
          <div className="mt-1">{item.extractionReason || "Confidence is below 80 or client email was not found."}</div>
          {Array.isArray(item.rejectedEmails) && item.rejectedEmails.length ? (
            <div className="mt-2 text-xs">Rejected emails: {item.rejectedEmails.join(", ")}</div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-line p-4">
        <h3 className="font-bold">Action controls</h3>
        <div className="mt-3">
          <LeadIntakeActions
            key={item.id}
            intakeId={item.id}
            clientEmail={cleanEmail(item.originalClientEmail || item.extractedClientEmail || "")}
            lowConfidence={Boolean(item.needsManualConfirmation)}
            isForwardedWarmReply={isWarm}
            sandipReviewPending={isSandipReviewPending(item)}
          />
        </div>
      </section>

      <MessageChain messages={Array.isArray(item.relatedMessages) ? item.relatedMessages : [item]} />
      <DetailBlock title="Latest client reply" value={item.latestClientMessage || item.originalClientMessage} initiallyOpen={Boolean(item.latestClientMessage)} />
      <DetailBlock title="Original outreach" value={item.previousProviderMessages || item.originalConversationText} />
      <DetailBlock title="Raw forward" value={item.fullForwardedChain || item.forwardedClientMessage || item.rawText} />
    </div>
  );
}

function cleanEmail(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/\[mailto\]/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, " ")
    .trim();
  return cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || cleaned;
}

function MessageChain({ messages }: { messages: LeadIntakeRow[] }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h3 className="font-bold">Conversation chain</h3>
      <div className="mt-3 space-y-2">
        {messages.map((message) => (
          <details key={message.id} className="rounded-md border border-line bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm">
              <span className="font-semibold">{message.subject || "No subject"}</span>
              <span className="ml-2 text-xs text-slate-500">
                <ClientDateTime value={message.receivedAt || message.importedAt} timeStyle="short" /> · {message.fromEmail || "Unknown sender"}
              </span>
            </summary>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 text-xs leading-5 text-slate-700">
              {message.latestClientMessage || message.originalClientMessage || message.forwardedClientMessage || message.rawText || "No preview available."}
            </pre>
          </details>
        ))}
      </div>
    </section>
  );
}

function DetailBlock({ title, value, initiallyOpen = false }: { title: string; value?: string | null; initiallyOpen?: boolean }) {
  return (
    <details open={initiallyOpen} className="rounded-lg border border-line bg-white p-3">
      <summary className="cursor-pointer text-sm font-bold text-slate-700">{title}</summary>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">
        {value || "No content available."}
      </pre>
    </details>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="mb-1.5 grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 break-words font-medium text-slate-800">{value || "Not found"}</span>
    </div>
  );
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "amber" | "red" | "emerald" }) {
  const classes = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700"
  };
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${classes[tone]}`}>{children}</span>;
}

function isForwardedWarmReply(item: LeadIntakeRow) {
  return item.leadSourceType === "forwarded_provider_lead" || item.replyMode === "continue_existing_conversation" || item.conversationType === "warm_reply";
}

function isSandipReviewPending(item: LeadIntakeRow) {
  return Boolean(item.sandipReviewRequired && item.sandipDecisionStatus === "pending");
}

function approvalStatus(status: string) {
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Not Approved";
  return "Pending";
}

function approvalStatusTone(status: string): "emerald" | "red" | "amber" {
  if (status === "APPROVED") return "emerald";
  if (status === "REJECTED") return "red";
  return "amber";
}

function suggestedAction(item: LeadIntakeRow) {
  if (isForwardedWarmReply(item)) {
    return "Generate a context reply as Abhay and continue the client conversation. Provider metadata stays out of the outgoing email.";
  }
  if (item.needsManualConfirmation) return "Confirm the actual client email before assignment or draft generation.";
  if (item.status === "REJECTED") return "Not approved for normal assignment. Admin can still continue manually if needed.";
  return "Review, approve, assign to sales, or generate a first reply draft.";
}

function leadAgeClassification(value: string | Date) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 30) return "NEW_LEAD";
  if (days <= 180) return "OLD_LEAD";
  if (days <= 730) return "DORMANT_LEAD";
  return "REVIVAL_LEAD";
}
