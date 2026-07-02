"use client";

import { apiFetch } from "@/lib/api";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ClientDateTime } from "@/components/ClientDateTime";
import { ProfessionalEmailComposer } from "@/components/ProfessionalEmailComposer";

type DraftForEditor = {
  id: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  body: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
  attachmentMetadata?: unknown;
  status: string;
  trackingEnabled: boolean;
  draftType?: string;
  followupStage?: number | null;
  draftVersion?: number;
  basedOnMessageId?: string | null;
  basedOnEmailDate?: Date | string | null;
  createdAt?: Date | string;
};

export function DraftEditor({
  draft,
  fromEmail,
  clientEmailConfidence,
  clientTimezone = "UTC",
  nextBestSendTime,
  nextBestSendTimeIso,
  businessHoursWarning,
  latestClientMessageAt,
  isStale = false
}: {
  draft: DraftForEditor;
  fromEmail?: string;
  clientEmailConfidence?: number | null;
  clientTimezone?: string;
  nextBestSendTime?: string;
  nextBestSendTimeIso?: string;
  businessHoursWarning?: string | null;
  latestClientMessageAt?: Date | string | null;
  isStale?: boolean;
}) {
  const router = useRouter();
  const [to, setTo] = useState(draft.toEmails.join(", "));
  const [cc, setCc] = useState(draft.ccEmails.join(", "));
  const [bcc, setBcc] = useState(draft.bccEmails.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [bodyHtml, setBodyHtml] = useState(draft.bodyHtml || "");
  const [attachments, setAttachments] = useState<{ id: string; name: string; size: number; type: string }[]>(
    Array.isArray(draft.attachmentMetadata) ? draft.attachmentMetadata as { id: string; name: string; size: number; type: string }[] : []
  );
  const [trackingEnabled, setTrackingEnabled] = useState(draft.trackingEnabled);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [freshBanner, setFreshBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"BEST" | "CUSTOM" | null>(null);
  const [customClientLocalTime, setCustomClientLocalTime] = useState("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [safetyPreview, setSafetyPreview] = useState<any>(null);
  const handleComposerChange = useCallback((value: { html: string; text: string; attachments: { id: string; name: string; size: number; type: string }[] }) => {
    setBodyHtml(value.html);
    setBody(value.text);
    setAttachments(value.attachments);
  }, []);
  const markDirty = useCallback(() => {
    setDirty(true);
    setMessage("");
  }, []);

  useEffect(() => {
    setTo(draft.toEmails.join(", "));
    setCc(draft.ccEmails.join(", "));
    setBcc(draft.bccEmails.join(", "));
    setSubject(draft.subject);
    setBody(draft.body);
    setBodyHtml(draft.bodyHtml || "");
    setAttachments(Array.isArray(draft.attachmentMetadata) ? draft.attachmentMetadata as { id: string; name: string; size: number; type: string }[] : []);
    setTrackingEnabled(draft.trackingEnabled);
    setDirty(false);
    setMessage("");
    const freshDraftId = window.sessionStorage.getItem("freshDraftGeneratedId");
    if (freshDraftId === draft.id) {
      setFreshBanner(true);
      window.sessionStorage.removeItem("freshDraftGeneratedId");
    } else {
      setFreshBanner(false);
    }
    window.setTimeout(() => {
      document.getElementById("draft-editor-start")?.scrollIntoView({ behavior: "smooth", block: "start" });
      const editable = document.querySelector<HTMLElement>(".ProseMirror");
      editable?.focus();
    }, 150);
  }, [draft]);

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await apiFetch(`/api/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload())
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to save draft");
      return;
    }
    setMessage("Draft saved");
    setDirty(false);
    router.refresh();
  }

  async function confirmSend() {
    setSending(true);
    setMessage("");
    const response = await apiFetch(`/api/drafts/${draft.id}/approve-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload())
    });
    const data = await response.json();
    setSending(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to send email");
      return;
    }
    setMessage(data.sent?.message || (data.sent?.queued ? "Email queued and will send at next safe time." : "Confirmed and sent"));
    setDirty(false);
    setShowReview(false);
    router.refresh();
  }

  async function confirmSchedule() {
    if (confidenceWarning) {
      setMessage("Client email confidence is below 80%. Confirm the client email before scheduling.");
      return;
    }
    setSending(true);
    setMessage("");
    const response = await apiFetch("/api/scheduled-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload(),
        draftId: draft.id,
        scheduleType: scheduleMode || "BEST",
        customClientLocalTime: scheduleMode === "CUSTOM" ? customClientLocalTime : undefined
      })
    });
    const data = await response.json();
    setSending(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to schedule email");
      return;
    }
    setMessage(data.scheduledEmail?.status === "QUEUED" ? "Email queued and will send at next safe time." : "Email scheduled");
    setDirty(false);
    setShowReview(false);
    setScheduleMode(null);
    router.refresh();
  }

  function payload() {
    return {
      toEmails: splitEmails(to),
      ccEmails: splitEmails(cc),
      bccEmails: splitEmails(bcc),
      subject,
      body,
      bodyHtml,
      bodyText: body,
      attachmentMetadata: attachments,
      trackingEnabled,
      safetyConfirmed,
      fromEmail
    };
  }

  const sent = draft.status === "SENT";
  const scheduled = draft.status === "SCHEDULED";
  const confidenceWarning = typeof clientEmailConfidence === "number" && clientEmailConfidence < 80;
  const customClientPreview = customClientLocalTime ? `${customClientLocalTime} ${clientTimezone}` : "Choose a custom client local time";
  const customIndiaPreview = customClientLocalTime ? formatIndiaTime(localDateTimeToUtcClient(customClientLocalTime, clientTimezone)) : "Choose a custom client local time";

  function openScheduleReview() {
    setScheduleMode("BEST");
    setSafetyConfirmed(false);
    setShowReview(true);
  }

  function openPreview() {
    window.dispatchEvent(new CustomEvent("composer-preview", { detail: { mode: "desktop" } }));
  }

  useEffect(() => {
    function runAction(event?: Event) {
      const action = (event as CustomEvent<{ action?: string }> | undefined)?.detail?.action
        || window.sessionStorage.getItem("pendingDraftEditorAction")
        || "";
      if (!action) return;
      window.sessionStorage.removeItem("pendingDraftEditorAction");
      if (action === "schedule") openScheduleReview();
      if (action === "send") {
        setScheduleMode(null);
        setSafetyConfirmed(false);
        setShowReview(true);
      }
      if (action === "template") {
        window.dispatchEvent(new Event("composer-open-templates"));
      }
    }
    window.addEventListener("draft-editor-action", runAction);
    window.setTimeout(() => runAction(), 250);
    return () => window.removeEventListener("draft-editor-action", runAction);
  }, [draft.id]);

  useEffect(() => {
    if (!showReview) return;
    let cancelled = false;
    apiFetch(`/api/drafts/${draft.id}/safety-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload(),
        body: body,
        bodyHtml,
        bodyText: body
      })
    })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setSafetyPreview(data.decision || null);
      })
      .catch(() => {
        if (!cancelled) setSafetyPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showReview, draft.id, to, cc, bcc, subject, body, bodyHtml, fromEmail]);

  return (
    <section id="draft-editor-start" className="rounded-xl border border-line bg-white p-5">
      {freshBanner ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-bold">New draft generated from latest client reply.</div>
          <p className="mt-1">The composer has been refreshed with the newest AI draft.</p>
        </div>
      ) : null}
      {isStale ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This draft was created before the latest client reply.
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Reply Composer</h2>
          <p className="text-sm text-slate-500">Write manually, use AI assist, insert a template, then review, send, or schedule. This app never auto-sends.</p>
        </div>
        <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-medium">{draft.status}</span>
      </div>
      <div className="mb-4 grid gap-3 rounded-lg border border-line bg-slate-50 p-3 text-sm md:grid-cols-3">
        <ReviewMeta label="Email Type" value={draft.draftType === "FOLLOWUP" ? "Follow-up" : "Reply"} />
        <ReviewMeta label="Draft created" value={<ClientDateTime value={draft.createdAt} fallback="--" timeStyle="short" />} />
        <ReviewMeta
          label="Based on"
          value={draft.draftType === "FOLLOWUP"
            ? <>Last sent email on <ClientDateTime value={draft.basedOnEmailDate} fallback="--" timeStyle="short" /></>
            : draft.basedOnEmailDate ? <ClientDateTime value={draft.basedOnEmailDate} timeStyle="short" /> : "Latest client message"}
        />
        {draft.draftType === "FOLLOWUP" ? <ReviewMeta label="Client reply after last sent" value="No" /> : null}
        <ReviewMeta label="Version" value={draft.draftVersion ? `v${draft.draftVersion}` : "v1"} />
        {latestClientMessageAt ? <ReviewMeta label="Latest client reply" value={<ClientDateTime value={latestClientMessageAt} timeStyle="short" />} /> : null}
        {draft.basedOnMessageId ? <ReviewMeta label="Message-ID" value={draft.basedOnMessageId} /> : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <EmailInput label="To" value={to} onChange={(value) => { setTo(value); markDirty(); }} disabled={sent || scheduled} />
        <EmailInput label="CC" value={cc} onChange={(value) => { setCc(value); markDirty(); }} disabled={sent || scheduled} />
        <EmailInput label="BCC" value={bcc} onChange={(value) => { setBcc(value); markDirty(); }} disabled={sent || scheduled} />
      </div>

      <label className="mt-4 block">
        <span className="text-sm font-medium">Subject</span>
        <input
          value={subject}
          onChange={(event) => { setSubject(event.target.value); markDirty(); }}
          disabled={sent || scheduled}
          className="mt-1 h-10 w-full rounded-md border border-line px-3"
        />
      </label>
      <label className="mt-4 block">
        <span className="mb-1 block text-sm font-medium">Body</span>
        <ProfessionalEmailComposer
          key={draft.id}
          initialHtml={bodyHtml || draft.bodyHtml}
          initialText={body}
          subject={subject}
          onSubject={(value) => {
            setSubject(value);
            markDirty();
          }}
          onChange={handleComposerChange}
          onDirty={markDirty}
        />
      </label>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trackingEnabled}
          onChange={(event) => { setTrackingEnabled(event.target.checked); markDirty(); }}
          disabled={sent || scheduled}
        />
        Tracking enabled
      </label>
      <div className="sticky bottom-0 z-10 -mx-5 mt-4 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 px-5 py-3 backdrop-blur-xl">
        <Button variant="secondary" onClick={save} disabled={saving || sent || scheduled}>
          {saving ? "Saving..." : "Save Draft"}
        </Button>
        <Button variant="secondary" onClick={openScheduleReview} disabled={sending || sent || scheduled}>
          Schedule
        </Button>
        <Button variant="secondary" onClick={openPreview} disabled={sent || scheduled}>
          Preview
        </Button>
        <Button onClick={() => { setScheduleMode(null); setSafetyConfirmed(false); setShowReview(true); }} disabled={sending || sent || scheduled}>
          Review & Send
        </Button>
        {message ? (
          <span className="text-sm text-slate-600">
            {message}
            {message === "Email scheduled" || message === "Email queued and will send at next safe time." ? (
              <>
                {" "}
                <Link href={fromEmail ? `/scheduled?mailbox=${encodeURIComponent(fromEmail)}` : "/scheduled"} className="font-semibold text-accent hover:underline">View Scheduled Emails</Link>
              </>
            ) : null}
          </span>
        ) : null}
        {!message && dirty ? <span className="text-sm font-medium text-amber-700">Unsaved changes</span> : null}
      </div>

      {showReview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold">Send Review</h3>
                <p className="text-sm text-slate-500">Confirm details before sending from Abhay.</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setShowReview(false)} disabled={sending}>
                Close
              </Button>
            </div>
            {confidenceWarning ? (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Client email confidence is below 80%. Please verify the recipient before sending.
              </div>
            ) : null}
            {businessHoursWarning ? (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {businessHoursWarning}
              </div>
            ) : null}
            <ReviewRow label="From" value="abhay@aresourcepool.com" />
            <ReviewRow label="To" value={splitEmails(to).join(", ") || "Not set"} />
            <ReviewRow label="CC" value={splitEmails(cc).join(", ") || "None"} />
            <ReviewRow label="BCC" value={splitEmails(bcc).join(", ") || "None"} />
            <ReviewRow label="Subject" value={subject} />
            <ReviewRow label="Email type" value={safetyPreview?.emailType || (draft.draftType === "FOLLOWUP" ? "FOLLOW_UP" : "CONVERSATION_REPLY")} />
            <ReviewRow label="Client timezone" value={clientTimezone} />
            {safetyPreview?.duplicateGuardBypassed ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Active conversation detected. Duplicate follow-up guard bypassed.
              </div>
            ) : null}
            {safetyPreview?.action === "QUEUE" && safetyPreview?.reason ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This may be queued: {safetyPreview.reason}
              </div>
            ) : null}
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Body</div>
              <div className="mt-1 max-h-80 overflow-auto rounded-md bg-slate-50 p-3 text-sm leading-6" dangerouslySetInnerHTML={{ __html: bodyHtml || body.replace(/\n/g, "<br>") }} />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackingEnabled}
                onChange={(event) => setTrackingEnabled(event.target.checked)}
              />
              Tracking enabled
            </label>
            <div className="mt-3 rounded-md border border-line bg-slate-50 p-3 text-sm">
              <div className="font-semibold">Deliverability safety</div>
              <p className="mt-1 text-slate-600">
                The server will check send limits, duplicate sends, bounced/unsubscribed signals, and spam-risk content before sending.
              </p>
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={safetyConfirmed}
                  onChange={(event) => setSafetyConfirmed(event.target.checked)}
                />
                I reviewed deliverability warnings and approve this send if only non-critical warnings are found.
              </label>
            </div>
            {scheduleMode ? (
              <div className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-sm">
                <div className="font-semibold">Schedule Review</div>
                <div className="mt-1">Scheduled client local time: {scheduleMode === "BEST" ? nextBestSendTime || "Best time unavailable" : customClientPreview}</div>
                <div className="mt-1">Scheduled India time: {scheduleMode === "BEST" && nextBestSendTimeIso ? <ClientDateTime value={nextBestSendTimeIso} timeZone="Asia/Kolkata" timeStyle="short" /> : customIndiaPreview}</div>
                {scheduleMode === "CUSTOM" ? (
                  <label className="mt-3 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custom client local time</span>
                    <input
                      type="datetime-local"
                      value={customClientLocalTime}
                      onChange={(event) => setCustomClientLocalTime(event.target.value)}
                      className="mt-1 h-10 rounded-md border border-line px-3 text-sm"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowReview(false)} disabled={sending}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={() => setScheduleMode("CUSTOM")} disabled={sending || confidenceWarning}>
                Schedule Custom Time
              </Button>
              <Button type="button" variant="secondary" onClick={() => setScheduleMode("BEST")} disabled={sending || confidenceWarning}>
                Schedule Best Time
              </Button>
              {scheduleMode ? (
                <Button type="button" onClick={confirmSchedule} disabled={sending || (scheduleMode === "CUSTOM" && !customClientLocalTime)}>
                  {sending ? "Scheduling..." : "Confirm Schedule"}
                </Button>
              ) : null}
              <Button type="button" onClick={confirmSend} disabled={sending}>
                {sending ? "Sending..." : "Send Now"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EmailInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-1 h-10 w-full rounded-md border border-line px-3"
        placeholder="name@example.com"
      />
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-line py-2 text-sm">
      <span className="font-semibold">{label}: </span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function ReviewMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 truncate font-medium text-slate-800">{value}</div>
    </div>
  );
}

function splitEmails(value: string) {
  return value
    .split(/[,\n;]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function localDateTimeToUtcClient(value: string, timezone: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(utcGuess);
  const actualYear = Number(parts.find((part) => part.type === "year")?.value || year);
  const actualMonth = Number(parts.find((part) => part.type === "month")?.value || month);
  const actualDay = Number(parts.find((part) => part.type === "day")?.value || day);
  const actualHour = Number(parts.find((part) => part.type === "hour")?.value || 0) % 24;
  const actualMinute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const desiredLocal = Date.UTC(year, month - 1, day, hour, minute, 0);
  const actualLocal = Date.UTC(actualYear, actualMonth - 1, actualDay, actualHour, actualMinute, 0);
  return new Date(utcGuess.getTime() - (actualLocal - desiredLocal));
}

function formatIndiaTime(date: Date) {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}
