"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";

export function WhatsAppSettingsPanel({ settings: initialSettings }: { settings: any }) {
  const [settings, setSettings] = useState(initialSettings || {});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/whatsapp/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save WhatsApp settings.");
      setSettings(data.settings);
      setMessage("WhatsApp settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save WhatsApp settings.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/whatsapp/test", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Connection test failed.");
      setSettings(data.settings);
      setMessage("WhatsApp connection verified.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="premium-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">WhatsApp Business</h2>
          <p className="text-sm text-muted">Meta Cloud API connection. Messages are drafted and sent only after human approval.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${settings.status === "CONNECTED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {settings.status || "DISCONNECTED"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold">
          <span>Enabled</span>
          <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2" value={settings.enabled ? "true" : "false"} onChange={(event) => setSettings({ ...settings, enabled: event.target.value === "true" })}>
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>
        <Field label="Business display number" value={settings.businessDisplayNumber || ""} onChange={(value) => setSettings({ ...settings, businessDisplayNumber: value })} />
        <Field label="Meta business account ID" value={settings.metaBusinessAccountId || ""} onChange={(value) => setSettings({ ...settings, metaBusinessAccountId: value })} />
        <Field label="Phone number ID" value={settings.phoneNumberId || ""} onChange={(value) => setSettings({ ...settings, phoneNumberId: value })} />
        <Field label="Permanent access token" value="" placeholder={settings.accessTokenConfigured ? "Configured. Enter new token to replace." : "Paste token"} onChange={(value) => setSettings({ ...settings, permanentAccessToken: value })} />
        <Field label="Webhook verify token" value={settings.webhookVerifyToken || ""} onChange={(value) => setSettings({ ...settings, webhookVerifyToken: value })} />
        <Field label="Default country code" value={settings.defaultCountry || ""} placeholder="+91" onChange={(value) => setSettings({ ...settings, defaultCountry: value })} />
        <Field label="Daily send limit" value={String(settings.dailySendLimit || 50)} onChange={(value) => setSettings({ ...settings, dailySendLimit: value })} />
        <Field label="Max messages/minute" value={String(settings.maxMessagesPerMinute || 5)} onChange={(value) => setSettings({ ...settings, maxMessagesPerMinute: value })} />
      </div>
      {message ? <div className="mt-4 rounded-xl border border-line bg-subtle px-3 py-2 text-sm text-muted">{message}</div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary h-10 rounded-xl px-4 text-sm font-semibold" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save WhatsApp Settings"}</button>
        <button type="button" className="btn-secondary h-10 rounded-xl px-4 text-sm font-semibold" onClick={test} disabled={testing}>{testing ? "Testing..." : "Test Connection"}</button>
      </div>
    </section>
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
