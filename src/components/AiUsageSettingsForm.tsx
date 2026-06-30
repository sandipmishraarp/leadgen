"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

type Settings = {
  dailyTokenLimit: number;
  dailyCostLimit: number;
  perUserDailyTokenLimit?: number | null;
  smallModel: string;
  mainModel: string;
  bulkDraftsPerHour: number;
};

export function AiUsageSettingsForm({ settings }: { settings: Settings }) {
  const [form, setForm] = useState({
    dailyTokenLimit: String(settings.dailyTokenLimit),
    dailyCostLimit: String(settings.dailyCostLimit),
    perUserDailyTokenLimit: settings.perUserDailyTokenLimit ? String(settings.perUserDailyTokenLimit) : "",
    smallModel: settings.smallModel,
    mainModel: settings.mainModel,
    bulkDraftsPerHour: String(settings.bulkDraftsPerHour)
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/ai-usage/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyTokenLimit: Number(form.dailyTokenLimit || 0),
        dailyCostLimit: Number(form.dailyCostLimit || 0),
        perUserDailyTokenLimit: form.perUserDailyTokenLimit ? Number(form.perUserDailyTokenLimit) : null,
        smallModel: form.smallModel,
        mainModel: form.mainModel,
        bulkDraftsPerHour: Number(form.bulkDraftsPerHour || 10)
      })
    });
    const data = await response.json();
    setSaving(false);
    setMessage(response.ok ? "AI budget settings saved." : data.error || "Unable to save settings");
  }

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="premium-card p-5">
      <div className="mb-4">
        <h2 className="font-bold">Daily Budget Limits</h2>
        <p className="mt-1 text-sm text-muted">AI calls are blocked once daily token or cost limits are reached.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Daily token limit" value={form.dailyTokenLimit} onChange={(value) => update("dailyTokenLimit", value)} />
        <Field label="Daily cost limit ($)" value={form.dailyCostLimit} onChange={(value) => update("dailyCostLimit", value)} />
        <Field label="Per-user token limit" value={form.perUserDailyTokenLimit} onChange={(value) => update("perUserDailyTokenLimit", value)} placeholder="Optional" />
        <Field label="Small model" value={form.smallModel} onChange={(value) => update("smallModel", value)} />
        <Field label="Main model" value={form.mainModel} onChange={(value) => update("mainModel", value)} />
        <Field label="Bulk drafts/hour" value={form.bulkDraftsPerHour} onChange={(value) => update("bulkDraftsPerHour", value)} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Limits"}</Button>
        {message ? <span className="text-sm text-muted">{message}</span> : null}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"
      />
    </label>
  );
}
