"use client";

import { useMemo, useState } from "react";
import { ClientDateTime } from "@/components/ClientDateTime";

export function WhatsAppLeadPanel({ lead, contactBlock }: { lead: any; contactBlock?: any }) {
  const initialContact = lead?.whatsappContact || {};
  const [contact, setContact] = useState({
    whatsappNumber: initialContact.whatsappNumber || lead?.phone || "",
    countryCode: initialContact.countryCode || "",
    preferredContactMethod: initialContact.preferredContactMethod || "Email",
    whatsappAvailable: initialContact.whatsappAvailable || "Unknown",
    contactVerified: Boolean(initialContact.contactVerified),
    notes: initialContact.notes || ""
  });
  const [messages, setMessages] = useState(Array.isArray(lead?.whatsappMessages) ? lead.whatsappMessages : []);
  const [status, setStatus] = useState("");
  const drafts = useMemo(() => messages.filter((message: any) => message.status === "DRAFT"), [messages]);
  const latestDraft = drafts[0];

  async function saveContact() {
    await run(async () => {
      const response = await fetch(`/api/leads/${lead.id}/whatsapp-contact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save WhatsApp contact.");
      setStatus(data.warning || "WhatsApp contact saved.");
    });
  }

  async function generateDraft() {
    if (contactBlock?.blocked) {
      setStatus(`Draft not generated: ${contactBlock.reason || "lead is marked Do Not Contact."}`);
      return;
    }
    await run(async () => {
      const response = await fetch(`/api/leads/${lead.id}/whatsapp-draft`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to generate WhatsApp draft.");
      setMessages([data.message, ...messages]);
      setStatus("WhatsApp draft ready for review.");
    });
  }

  async function sendDraft(id: string) {
    await run(async () => {
      const response = await fetch(`/api/whatsapp/messages/${id}/send`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send WhatsApp message.");
      setMessages(messages.map((message: any) => message.id === id ? data.message : message));
      setStatus("WhatsApp message sent.");
    });
  }

  async function run(fn: () => Promise<void>) {
    setStatus("");
    try {
      await fn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "WhatsApp action failed.");
    }
  }

  return (
    <div id="whatsapp" className="space-y-4">
      {contactBlock?.blocked ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-bold">Do Not Contact</div>
          <div className="mt-1">{contactBlock.reason || "This lead is blocked from outreach."}</div>
        </section>
      ) : null}
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Client WhatsApp Contact</h2>
            <p className="text-sm text-muted">Verify the number before drafting or sending. No WhatsApp message is sent automatically.</p>
          </div>
          <button type="button" className="btn-primary h-10 rounded-xl px-4 text-sm font-semibold" onClick={saveContact}>Save Contact</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="WhatsApp number" value={contact.whatsappNumber} onChange={(value) => setContact({ ...contact, whatsappNumber: value })} />
          <Field label="Country code" value={contact.countryCode} placeholder="+1" onChange={(value) => setContact({ ...contact, countryCode: value })} />
          <Field label="Preferred contact method" value={contact.preferredContactMethod} onChange={(value) => setContact({ ...contact, preferredContactMethod: value })} />
          <Field label="WhatsApp available" value={contact.whatsappAvailable} onChange={(value) => setContact({ ...contact, whatsappAvailable: value })} />
          <label className="flex items-center gap-2 rounded-xl border border-line bg-subtle px-3 py-2 text-sm font-semibold">
            <input type="checkbox" checked={contact.contactVerified} onChange={(event) => setContact({ ...contact, contactVerified: event.target.checked })} />
            Contact verified
          </label>
          <Field label="Notes" value={contact.notes} onChange={(value) => setContact({ ...contact, notes: value })} />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">WhatsApp Draft</h2>
            <p className="text-sm text-muted">Short manual follow-up, max 500 characters.</p>
          </div>
          <button type="button" className="btn-secondary h-10 rounded-xl px-4 text-sm font-semibold" onClick={generateDraft} disabled={Boolean(contactBlock?.blocked)}>Generate WhatsApp Draft</button>
        </div>
        {latestDraft ? (
          <div className="rounded-xl border border-line bg-subtle p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Pending approval</div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{latestDraft.body}</pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary h-10 rounded-xl px-4 text-sm font-semibold" onClick={() => sendDraft(latestDraft.id)}>Approve & Send WhatsApp</button>
              <button type="button" className="btn-secondary h-10 rounded-xl px-4 text-sm font-semibold" onClick={() => navigator.clipboard?.writeText(latestDraft.body)}>Copy</button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-subtle p-4 text-sm text-muted">No WhatsApp draft yet.</div>
        )}
        {status ? <div className="mt-3 rounded-xl border border-line bg-subtle px-3 py-2 text-sm text-muted">{status}</div> : null}
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">WhatsApp CRM Timeline</h2>
        <div className="mt-3 space-y-2">
          {messages.length ? messages.map((message: any) => (
            <div key={message.id} className="rounded-xl border border-line bg-subtle p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-bold">{message.direction === "INBOUND" ? "Client reply" : "Outbound"} · {message.status}</span>
                <ClientDateTime value={message.sentAt || message.receivedAt || message.createdAt} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-muted">{message.body}</p>
            </div>
          )) : <div className="rounded-xl border border-dashed border-line bg-subtle p-4 text-sm text-muted">No WhatsApp activity yet.</div>}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-semibold">
      <span>{label}</span>
      <input className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
