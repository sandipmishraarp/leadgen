"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ClientDateTime } from "@/components/ClientDateTime";

type ScheduledEmailItem = {
  id: string;
  leadId: string;
  toEmail: string;
  cc: string | null;
  bcc: string | null;
  subject: string;
  body: string;
  scheduledAt: Date | string;
  clientTimezone: string | null;
  clientLocalScheduledAt: string | null;
  status: string;
  trackingEnabled: boolean;
  failureReason: string | null;
  lead: { id: string; name: string | null; email: string; company: string | null };
};

export function ScheduledEmailsPanel({ items }: { items: ScheduledEmailItem[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const tabs = [
    { id: "active", label: "Scheduled", count: items.filter((item) => item.status === "SCHEDULED").length },
    { id: "queued", label: "Queued", count: items.filter((item) => item.status === "QUEUED" || item.status === "RETRY").length },
    { id: "due", label: "Due Now", count: items.filter((item) => ["SCHEDULED", "QUEUED", "RETRY"].includes(item.status) && new Date(item.scheduledAt).getTime() <= Date.now()).length },
    { id: "failed", label: "Failed", count: items.filter((item) => item.status === "FAILED").length },
    { id: "sent", label: "Sent", count: items.filter((item) => item.status === "SENT").length }
  ];
  const visibleItems = items.filter((item) => {
    if (activeTab === "queued") return item.status === "QUEUED" || item.status === "RETRY";
    if (activeTab === "due") return ["SCHEDULED", "QUEUED", "RETRY"].includes(item.status) && new Date(item.scheduledAt).getTime() <= Date.now();
    if (activeTab === "failed") return item.status === "FAILED";
    if (activeTab === "sent") return item.status === "SENT";
    return item.status === "SCHEDULED";
  });

  async function action(id: string, kind: "cancel" | "send-now") {
    setBusy(`${kind}:${id}`);
    setMessage("");
    const response = await apiFetch(`/api/scheduled-emails/${id}/${kind}`, { method: "POST" });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setMessage(data.error || "Action failed");
      return;
    }
    router.refresh();
  }

  async function processDue() {
    setBusy("process");
    setMessage("");
    const response = await apiFetch("/api/scheduled-emails/process", { method: "POST" });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setMessage(data.error || "Unable to process queue");
      return;
    }
    setMessage(`Processed ${data.result.processed}, sent ${data.result.sent}, queued ${data.result.skipped}, failed ${data.result.failed}`);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-bold">Queue</h2>
          <p className="text-sm text-slate-500">Approved scheduled emails and follow-ups.</p>
        </div>
        <div className="flex items-center gap-3">
          {message ? <span className="text-sm text-slate-600">{message}</span> : null}
          <Button type="button" variant="secondary" onClick={processDue} disabled={Boolean(busy)}>
            {busy === "process" ? "Processing..." : "Process Due Now"}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${activeTab === tab.id ? "border-accent bg-accent text-white" : "border-line bg-white text-slate-600"}`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
      <div className="divide-y divide-line">
        {visibleItems.map((item) => (
          <article key={item.id} className="px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr_0.8fr_130px_220px]">
              <div>
                <div className="font-semibold">{item.lead.name || item.lead.email}</div>
                <div className="text-sm text-slate-500">{item.lead.company || "Company not set"}</div>
                <div className="text-sm text-slate-500">{item.toEmail}</div>
              </div>
              <div>
                <div className="font-medium">{item.subject}</div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-500">{item.body}</div>
                {item.failureReason ? <div className="mt-2 text-sm text-red-700">{item.failureReason}</div> : null}
              </div>
              <div className="text-sm">
                <div><ClientDateTime value={item.scheduledAt} timeStyle="short" /></div>
                <div className="mt-1 text-slate-500">{item.clientLocalScheduledAt || "Client time not set"}</div>
                <div className="mt-1 text-xs text-slate-500">{item.clientTimezone || "UTC"}</div>
              </div>
              <div className="font-medium">{item.status}</div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditingId(editingId === item.id ? "" : item.id)} disabled={!["SCHEDULED", "QUEUED", "FAILED"].includes(item.status)}>
                  Edit
                </Button>
                <Button type="button" variant="secondary" onClick={() => action(item.id, "cancel")} disabled={Boolean(busy) || !["SCHEDULED", "QUEUED", "FAILED"].includes(item.status)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => action(item.id, "send-now")} disabled={Boolean(busy) || !["SCHEDULED", "QUEUED", "FAILED"].includes(item.status)}>
                  {item.status === "FAILED" ? "Retry" : "Send Now"}
                </Button>
              </div>
            </div>
            {editingId === item.id ? <ScheduledEmailEdit item={item} onDone={() => { setEditingId(""); router.refresh(); }} /> : null}
          </article>
        ))}
        {!visibleItems.length ? <div className="px-5 py-8 text-sm text-slate-500">No emails in this tab.</div> : null}
      </div>
    </section>
  );
}

function ScheduledEmailEdit({ item, onDone }: { item: ScheduledEmailItem; onDone: () => void }) {
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [trackingEnabled, setTrackingEnabled] = useState(item.trackingEnabled);
  const [scheduledClientLocalTime, setScheduledClientLocalTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await apiFetch(`/api/scheduled-emails/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, trackingEnabled, scheduledClientLocalTime: scheduledClientLocalTime || undefined })
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to save scheduled email");
      return;
    }
    onDone();
  }

  return (
    <div className="mt-4 rounded-md border border-line bg-slate-50 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-line px-3" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Client local time</span>
          <input type="datetime-local" value={scheduledClientLocalTime} onChange={(event) => setScheduledClientLocalTime(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-line px-3" />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-sm font-medium">Body</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} className="mt-1 w-full rounded-md border border-line p-3" />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={trackingEnabled} onChange={(event) => setTrackingEnabled(event.target.checked)} />
        Tracking enabled
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
        {message ? <span className="text-sm text-red-700">{message}</span> : null}
      </div>
    </div>
  );
}
