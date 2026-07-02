"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { Button } from "@/components/Button";
import { ClientDateTime } from "@/components/ClientDateTime";

type AutomationSettings = {
  autoSyncEnabled: boolean;
  autoClassifyEnabled: boolean;
  autoCreateReplyDrafts: boolean;
  autoCreateFollowupDrafts: boolean;
  autoBlockDoNotContact: boolean;
  autoSuggestSchedule: boolean;
  followup1Days: number;
  followup2Days: number;
  followup3Days: number;
  finalFollowupDays: number;
  lastRunAt: Date | string | null;
  lastError: string | null;
};

export function AutomationSettingsPanel({ settings }: { settings: AutomationSettings }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function update(key: keyof AutomationSettings, value: boolean | number) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await apiFetch("/api/automation-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to save automation settings");
      return;
    }
    setForm(data.settings);
    setMessage("Automation settings saved.");
  }

  return (
    <section className="premium-card p-5">
      <div className="mb-4">
        <h2 className="font-bold">Safe Automation</h2>
        <p className="mt-1 text-sm text-muted">Prepare work automatically. Emails still require human review and approval.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle label="Auto-sync" checked={form.autoSyncEnabled} onChange={(value) => update("autoSyncEnabled", value)} />
        <Toggle label="Auto-classify new mail" checked={form.autoClassifyEnabled} onChange={(value) => update("autoClassifyEnabled", value)} />
        <Toggle label="Auto-create reply drafts" checked={form.autoCreateReplyDrafts} onChange={(value) => update("autoCreateReplyDrafts", value)} />
        <Toggle label="Auto-create follow-up drafts" checked={form.autoCreateFollowupDrafts} onChange={(value) => update("autoCreateFollowupDrafts", value)} />
        <Toggle label="Auto-block do-not-contact" checked={form.autoBlockDoNotContact} onChange={(value) => update("autoBlockDoNotContact", value)} />
        <Toggle label="Auto-suggest schedule" checked={form.autoSuggestSchedule} onChange={(value) => update("autoSuggestSchedule", value)} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <NumberField label="Follow-up 1 days" value={form.followup1Days} onChange={(value) => update("followup1Days", value)} />
        <NumberField label="Follow-up 2 days" value={form.followup2Days} onChange={(value) => update("followup2Days", value)} />
        <NumberField label="Follow-up 3 days" value={form.followup3Days} onChange={(value) => update("followup3Days", value)} />
        <NumberField label="Final follow-up days" value={form.finalFollowupDays} onChange={(value) => update("finalFollowupDays", value)} />
      </div>
      <div className="mt-4 rounded-lg border border-line bg-subtle p-3 text-sm text-muted">
        Last automation run: <ClientDateTime value={form.lastRunAt} fallback="Never" timeStyle="short" />
        {form.lastError ? <div className="mt-1 text-red-700">Last error: {form.lastError}</div> : null}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Automation Settings"}</Button>
        {message ? <span className="text-sm text-muted">{message}</span> : null}
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle p-3 text-sm font-semibold">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block rounded-lg border border-line bg-subtle p-3 text-sm font-semibold">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value || 1))}
        className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3"
      />
    </label>
  );
}
