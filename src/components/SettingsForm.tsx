"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { Button } from "@/components/Button";

type Account = {
  emailAddress?: string;
  accountType?: "LEAD_INTAKE" | "SALES_SENDER" | "ADMIN";
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  inboxFolder?: string;
  sentFolder?: string | null;
  fetchLimit?: number;
  autoSyncEnabled?: boolean;
  excludedDomains?: string[];
  excludedEmails?: string[];
  internalDomain?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  hasImapPassword?: boolean;
  hasSmtpPassword?: boolean;
  hasOpenAIKey?: boolean;
} | null;

export function SettingsForm({ account }: { account: Account }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    setMessage(response.ok ? "Settings saved" : (await response.json()).error || "Unable to save settings");
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    const response = await apiFetch("/api/mail/test-connection", { method: "POST" });
    setTesting(false);
    setMessage(response.ok ? "IMAP and SMTP connection verified" : (await response.json()).error || "Connection failed");
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-lg border border-line bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Mailbox email</span>
          <input
            name="emailAddress"
            type="email"
            required
            defaultValue={account?.emailAddress || "abhay@aresourcepool.com"}
            className="mt-1 h-10 w-full rounded-md border border-line px-3"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Account type</span>
          <select
            name="accountType"
            defaultValue={account?.accountType || "SALES_SENDER"}
            className="mt-1 h-10 w-full rounded-md border border-line px-3"
          >
            <option value="LEAD_INTAKE">Lead intake - lead@aresourcepool.com</option>
            <option value="SALES_SENDER">Sales sender - abhay@aresourcepool.com</option>
            <option value="ADMIN">Admin - sandip@aresourcepool.com</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">OpenAI API key</span>
          <input
            name="openaiKey"
            type="password"
            placeholder={account?.hasOpenAIKey ? "Leave blank to keep existing" : "sk-..."}
            className="mt-1 h-10 w-full rounded-md border border-line px-3"
          />
        </label>
      </div>

      <div>
        <h2 className="mb-3 text-base font-bold">20i IMAP</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <input name="imapHost" required defaultValue={account?.imapHost} placeholder="IMAP host" className="h-10 rounded-md border border-line px-3" />
          <input name="imapPort" required defaultValue={account?.imapPort || 993} placeholder="993" className="h-10 rounded-md border border-line px-3" />
          <input name="imapUser" required defaultValue={account?.imapUser || "abhay@aresourcepool.com"} placeholder="IMAP user" className="h-10 rounded-md border border-line px-3" />
          <input name="imapPassword" type="password" placeholder={account?.hasImapPassword ? "Leave blank to keep existing" : "IMAP password"} className="h-10 rounded-md border border-line px-3" />
          <input name="inboxFolder" required defaultValue={account?.inboxFolder || "INBOX"} placeholder="Inbox folder" className="h-10 rounded-md border border-line px-3" />
          <input name="sentFolder" defaultValue={account?.sentFolder || ""} placeholder="Sent folder, blank for auto-detect" className="h-10 rounded-md border border-line px-3" />
          <select name="fetchLimit" defaultValue={account?.fetchLimit || 50} className="h-10 rounded-md border border-line px-3">
            {[50, 100, 250, 500].map((limit) => (
              <option key={limit} value={limit}>
                Fetch {limit}
              </option>
            ))}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm">
            <input name="autoSyncEnabled" type="checkbox" defaultChecked={account?.autoSyncEnabled || false} value="true" />
            Auto-sync later
          </label>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-bold">Filtering</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            name="internalDomain"
            required
            defaultValue={account?.internalDomain || "aresourcepool.com"}
            placeholder="Internal company domain"
            className="h-10 rounded-md border border-line px-3"
          />
          <textarea
            name="excludedDomains"
            defaultValue={(account?.excludedDomains || []).join("\n")}
            placeholder="Excluded domains, one per line"
            rows={4}
            className="rounded-md border border-line px-3 py-2"
          />
          <textarea
            name="excludedEmails"
            defaultValue={(account?.excludedEmails || []).join("\n")}
            placeholder="Excluded emails, one per line"
            rows={4}
            className="rounded-md border border-line px-3 py-2 md:col-span-2"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-bold">20i SMTP</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <input name="smtpHost" required defaultValue={account?.smtpHost} placeholder="SMTP host" className="h-10 rounded-md border border-line px-3" />
          <input name="smtpPort" required defaultValue={account?.smtpPort || 465} placeholder="465" className="h-10 rounded-md border border-line px-3" />
          <input name="smtpUser" required defaultValue={account?.smtpUser || "abhay@aresourcepool.com"} placeholder="SMTP user" className="h-10 rounded-md border border-line px-3" />
          <input name="smtpPassword" type="password" placeholder={account?.hasSmtpPassword ? "Leave blank to keep existing" : "SMTP password"} className="h-10 rounded-md border border-line px-3" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
        <Button type="button" variant="secondary" onClick={testConnection} disabled={testing}>
          {testing ? "Testing..." : "Test Connection"}
        </Button>
        {message ? <span className="text-sm text-slate-600">{message}</span> : null}
      </div>
    </form>
  );
}
