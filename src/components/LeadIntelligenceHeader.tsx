"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ClientDateTime } from "@/components/ClientDateTime";
import type { LeadIntelligence } from "@/lib/services/lead-intelligence";

type DraftForSchedule = {
  id: string;
  toEmails: string[];
  subject: string;
  body: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
  trackingEnabled: boolean;
} | null;

export function LeadIntelligenceHeader({
  leadId,
  intelligence,
  draft,
  clientEmail,
  fromEmail
}: {
  leadId: string;
  intelligence: LeadIntelligence;
  draft?: DraftForSchedule;
  clientEmail?: string | null;
  fromEmail?: string | null;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(intelligence.detectedTimezone);
  const [editingTimezone, setEditingTimezone] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [trackingEnabled, setTrackingEnabled] = useState(draft?.trackingEnabled ?? true);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const progressSteps = [
    "Analyzing conversation...",
    "Reading Client Brain...",
    "Reading Qualification...",
    "Selecting best strategy...",
    "Generating email...",
    "Finalizing..."
  ];

  useEffect(() => {
    if (!progressOpen) return;
    const timer = window.setInterval(() => {
      setProgressStep((step) => Math.min(progressSteps.length - 1, step + 1));
    }, 850);
    return () => window.clearInterval(timer);
  }, [progressOpen, progressSteps.length]);

  async function generateWithStrategy() {
    setBusy("generate");
    setMessage("");
    setProgressStep(0);
    setProgressOpen(true);
    const response = await apiFetch(`/api/leads/${leadId}/first-reply-draft`, { method: "POST" });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setProgressOpen(false);
      setMessage(data.error || "Unable to generate draft");
      return;
    }
    window.sessionStorage.setItem("leadDetailActiveTab", "drafts");
    if (data.draft?.id) window.sessionStorage.setItem("freshDraftGeneratedId", data.draft.id);
    window.sessionStorage.setItem("aiDraftReady", JSON.stringify({
      confidence: Math.round((data.draft?.confidence || 0.8) * 100),
      at: Date.now()
    }));
    window.location.hash = "drafts-composer";
    router.refresh();
    window.setTimeout(() => {
      setProgressOpen(false);
      window.dispatchEvent(new Event("lead-detail-open-tab"));
    }, 450);
  }

  async function updateIntelligence() {
    setBusy("timezone");
    setMessage("");
    const response = await apiFetch(`/api/leads/${leadId}/intelligence`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone, scheduleForBestTime: false })
    });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setMessage(data.error || "Unable to update intelligence");
      return;
    }
    setEditingTimezone(false);
    setMessage("Timezone updated");
    router.refresh();
  }

  function openScheduleReview() {
    setMessage("");
    if (!draft) {
      setMessage("Please generate or select a draft before scheduling.");
      return;
    }
    setReviewOpen(true);
  }

  async function confirmSchedule() {
    setBusy("confirm-schedule");
    setMessage("");
    if (!draft) {
      setBusy("");
      setMessage("Please generate or select a draft before scheduling.");
      return;
    }
    if (!clientEmail) {
      setBusy("");
      setMessage("Client email is missing.");
      return;
    }
    if (!fromEmail) {
      setBusy("");
      setMessage("Active sales account is missing.");
      return;
    }
    if (!draft.subject?.trim() || !draft.body?.trim()) {
      setBusy("");
      setMessage("Draft subject and body are required before scheduling.");
      return;
    }

    const response = await apiFetch("/api/scheduled-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId: draft.id,
        fromEmail,
        toEmails: [clientEmail],
        ccEmails: [],
        bccEmails: [],
        subject: draft.subject,
        body: draft.body,
        bodyHtml: draft.bodyHtml || undefined,
        bodyText: draft.bodyText || draft.body,
        trackingEnabled,
        scheduleType: "BEST"
      })
    });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setMessage(data.error || "Unable to schedule email");
      return;
    }
    setReviewOpen(false);
    setMessage("Email scheduled successfully");
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-lg border border-line bg-white">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">Lead Intelligence</h2>
            <p className="text-sm text-slate-500">Use timing, lead quality, and service context before drafting or sending.</p>
          </div>
          <span className={`rounded-md px-3 py-1 text-sm font-semibold ${intelligence.sendNowRecommendation === "Send Now" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {intelligence.sendNowRecommendation}
          </span>
        </div>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1fr_1.2fr]">
        <Intel label="Client local time" value={intelligence.currentLocalTime} />
        <Intel label="Best send time" value={intelligence.bestEmailWindow} />
        <Intel label="Next best send" value={intelligence.nextBestSendTime} />
        <Intel label="Business hours" value={intelligence.businessHoursStatus} />
        <Intel label="Reply chance" value={intelligence.replyProbability} />
        <Intel label="Confidence" value={`${intelligence.confidence}%`} />
        <div className="lg:col-span-3 rounded-md bg-slate-50 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested approach</div>
          <div className="mt-1 font-medium text-slate-800">{intelligence.suggestedEmailAngle}</div>
          <div className="mt-2 text-xs text-slate-500">
            Country: {intelligence.detectedCountry} · Timezone: {intelligence.detectedTimezone}
            {intelligence.timezoneWarning ? ` · ${intelligence.timezoneWarning}` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        <div>
          <Button type="button" onClick={generateWithStrategy} disabled={Boolean(busy)}>
            {busy === "generate" ? "Generating AI Draft..." : "✨ Generate AI Draft"}
          </Button>
          <div className="mt-1 text-xs text-muted">Uses Client Brain + Conversation + Lead Intelligence.</div>
        </div>
        <Button type="button" variant="secondary" onClick={openScheduleReview} disabled={Boolean(busy)}>
          {intelligence.sendNowRecommendation === "Schedule for Morning" ? "Schedule for Morning" : "Schedule for Best Time"}
        </Button>
        <Button type="button" variant="secondary" disabled={intelligence.sendNowRecommendation !== "Send Now"} onClick={() => setMessage("Review the draft below, then click Confirm & Send.")}>
          Send Now
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEditingTimezone((value) => !value)}>
          Edit Timezone
        </Button>
        {editingTimezone ? (
          <div className="flex items-center gap-2">
            <input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="h-10 rounded-md border border-line px-3 text-sm"
              placeholder="America/New_York"
            />
            <Button type="button" onClick={updateIntelligence} disabled={Boolean(busy)}>
              Save
            </Button>
          </div>
        ) : null}
        {message ? (
          <span className="text-sm text-slate-600">
            {message}
            {message === "Email scheduled successfully" ? (
              <>
                {" "}
                <Link href={`/scheduled?mailbox=${encodeURIComponent(fromEmail || "")}`} className="font-semibold text-accent hover:underline">
                  View Scheduled Emails
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {reviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={() => setReviewOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-line bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold">Schedule Review</h3>
                <p className="text-sm text-muted">Confirm the follow-up before adding it to the scheduled queue.</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setReviewOpen(false)} disabled={Boolean(busy)}>
                Close
              </Button>
            </div>
            {!draft ? (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Generate a draft first, then schedule it for the best send time.
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <ReviewRow label="From" value={fromEmail || "Missing active sales account"} />
              <ReviewRow label="To" value={clientEmail || "Missing client email"} />
              <ReviewRow label="Subject" value={draft?.subject || "Missing subject"} />
              <ReviewRow label="Client timezone" value={timezone} />
              <ReviewRow label="Scheduled client local time" value={intelligence.nextBestSendTime} />
              <ReviewRow label="Scheduled system time" value={<ClientDateTime value={intelligence.nextBestSendTimeIso} timeStyle="short" />} />
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Body</div>
              <div className="mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-3 text-sm leading-6">
                {draft?.body || "No draft body available."}
              </div>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={trackingEnabled} onChange={(event) => setTrackingEnabled(event.target.checked)} />
              Tracking enabled
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setReviewOpen(false)} disabled={Boolean(busy)}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmSchedule} disabled={Boolean(busy) || !draft || !clientEmail || !fromEmail}>
                {busy === "confirm-schedule" ? "Scheduling..." : "Confirm Schedule"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {progressOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold">Generating AI Draft</h3>
            <p className="mt-1 text-sm text-muted">Uses Client Brain, conversation, qualification, and lead intelligence.</p>
            <div className="mt-5 space-y-3">
              {progressSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-3 text-sm">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${index <= progressStep ? "bg-accent text-white" : "bg-subtle text-muted"}`}>
                    {index < progressStep ? "✓" : index + 1}
                  </div>
                  <span className={index <= progressStep ? "font-semibold text-ink" : "text-muted"}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function Intel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
