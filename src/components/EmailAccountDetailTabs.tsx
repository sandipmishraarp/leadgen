"use client";

import { apiFetch } from "@/lib/api";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Save } from "lucide-react";
import { ClientDateTime } from "@/components/ClientDateTime";
import { EmailAccountActions } from "@/components/EmailAccountActions";

const tabs = ["General", "Connection", "Folders", "Import", "Filters", "Scheduler", "Logs", "Danger Zone"];
const intervals = [
  { label: "Manual", value: "MANUAL" },
  { label: "Every 5 min", value: "EVERY_5_MIN" },
  { label: "Every 15 min", value: "EVERY_15_MIN" },
  { label: "Every 30 min", value: "EVERY_30_MIN" },
  { label: "Every 1 hour", value: "EVERY_1_HOUR" }
];
const batchSizes = [50, 100, 250, 500];
const concurrencyOptions = [1, 2, 3, 5];

export function EmailAccountDetailTabs({ account }: { account: any }) {
  const router = useRouter();
  const [active, setActive] = useState("General");
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderConfig = parseObject(account.folderConfig);
  const schedulerConfig = parseObject(account.schedulerConfig);
  const selectedFolders = useMemo(() => Array.isArray(folderConfig.selectedFolders) ? folderConfig.selectedFolders.map(String) : [], [folderConfig]);
  const latestJobs = account.leadImportJobs || [];

  async function refreshFolders() {
    setLoading("folders");
    setError(null);
    try {
      const response = await apiFetch(`/api/email-accounts/${account.id}/folders`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to refresh folders.");
      setFolders(data.flatFolders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh folders.");
    } finally {
      setLoading(null);
    }
  }

  async function savePatch(payload: Record<string, unknown>) {
    setLoading("save");
    setError(null);
    try {
      const response = await apiFetch(`/api/email-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save account.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save account.");
    } finally {
      setLoading(null);
    }
  }

  function toggleFolder(path: string) {
    const next = selectedFolders.includes(path)
      ? selectedFolders.filter((item: string) => item !== path)
      : [...selectedFolders, path];
    savePatch({ folderConfig: { ...folderConfig, selectedFolders: next } });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="premium-card p-3">
        <div className="space-y-1">
          {tabs.map((tab) => (
            <button key={tab} className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${active === tab ? "bg-accent text-white" : "text-muted hover:bg-subtle hover:text-ink"}`} onClick={() => setActive(tab)}>
              {tab}
            </button>
          ))}
        </div>
      </aside>

      <section className="premium-card p-5">
        {active === "General" ? (
          <div className="space-y-4">
            <Header title="General" detail="Identity, role, status, and account timeline." />
            <div className="grid gap-3 md:grid-cols-3">
              <Info label="Email" value={account.emailAddress} />
              <Info label="Role" value={account.role} />
              <Info label="Status" value={account.status} />
              <Info label="Created" value={<ClientDateTime value={account.createdAt} timeStyle="short" />} />
              <Info label="Last Sync" value={<ClientDateTime value={account.lastSyncedAt} fallback="Never" timeStyle="short" />} />
              <Info label="Description" value={account.description || "Not set"} />
            </div>
          </div>
        ) : null}

        {active === "Connection" ? (
          <div className="space-y-4">
            <Header title="Connection" detail="IMAP and SMTP configuration for this mailbox." />
            <div className="grid gap-3 md:grid-cols-2">
              <Info label="IMAP" value={`${account.imapHost}:${account.imapPort}`} />
              <Info label="IMAP User" value={account.imapUser} />
              <Info label="SMTP" value={`${account.smtpHost}:${account.smtpPort}`} />
              <Info label="SMTP User" value={account.smtpUser} />
              <Info label="Last Test" value={<ClientDateTime value={account.lastTestAt} fallback="Never" timeStyle="short" />} />
              <Info label="Password Stored" value={account.hasImapPassword && account.hasSmtpPassword ? "Yes, encrypted" : "Missing"} />
            </div>
            <EmailAccountActions accountId={account.id} canImport={account.accountType === "LEAD_INTAKE"} />
          </div>
        ) : null}

        {active === "Folders" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Header title="Folder Management" detail="Enable, disable, refresh, and search mailbox folders." />
              <button className="btn-secondary inline-flex items-center gap-2" onClick={refreshFolders} disabled={Boolean(loading)}>
                {loading === "folders" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Refresh
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                  <tr><th className="px-4 py-3">Folder</th><th className="px-4 py-3">Enabled</th><th className="px-4 py-3">Imported</th><th className="px-4 py-3">Last Sync</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(folders.length ? folders : selectedFolders.map((path: string) => ({ path, name: path, selectable: true }))).map((folder: any) => (
                    <tr key={folder.path}>
                      <td className="px-4 py-3 font-medium">{folder.path}</td>
                      <td className="px-4 py-3"><input type="checkbox" checked={selectedFolders.includes(folder.path)} onChange={() => toggleFolder(folder.path)} /></td>
                      <td className="px-4 py-3 text-muted">Tracked in import jobs</td>
                      <td className="px-4 py-3 text-muted"><ClientDateTime value={account.lastSyncedAt} fallback="Never" timeStyle="short" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {active === "Import" ? (
          <div className="space-y-4">
            <Header title="Import Center" detail="Running, completed, and failed imports for this account." />
            <div className="grid gap-3 md:grid-cols-4">
              <Info label="Running Jobs" value={String(latestJobs.filter((job: any) => job.status === "RUNNING").length)} />
              <Info label="Completed Jobs" value={String(latestJobs.filter((job: any) => job.status === "COMPLETED").length)} />
              <Info label="Failed Jobs" value={String(latestJobs.filter((job: any) => job.status === "FAILED").length)} />
              <Info label="Total Jobs" value={String(account._count?.leadImportJobs || latestJobs.length)} />
            </div>
            <div className="space-y-3">
              {latestJobs.map((job: any) => (
                <div key={job.id} className="rounded-lg border border-line bg-subtle p-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div className="font-bold">{job.status}</div>
                    <div className="text-sm text-muted"><ClientDateTime value={job.createdAt} timeStyle="short" /></div>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-white">
                    <div className="h-2 rounded-full bg-accent" style={{ width: `${progress(job)}%` }} />
                  </div>
                  <div className="mt-2 text-sm text-muted">Imported {job.importedCount} · Skipped {job.skippedCount} · Errors {job.errorCount}</div>
                </div>
              ))}
              {!latestJobs.length ? <div className="rounded-lg border border-dashed border-line bg-subtle p-5 text-sm text-muted">No import jobs yet.</div> : null}
            </div>
          </div>
        ) : null}

        {active === "Filters" ? (
          <FiltersPanel account={account} onSave={savePatch} loading={loading === "save"} />
        ) : null}

        {active === "Scheduler" ? (
          <SchedulerPanel config={schedulerConfig} onSave={savePatch} loading={loading === "save"} />
        ) : null}

        {active === "Logs" ? (
          <div className="space-y-4">
            <Header title="Logs" detail="Connection, sync, import, SMTP, and account history." />
            <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-subtle p-4 text-xs">{JSON.stringify(account.connectionStatus || {}, null, 2)}</pre>
            <div className="text-sm text-muted">Detailed log stream remains in Activity and import job history.</div>
          </div>
        ) : null}

        {active === "Danger Zone" ? (
          <div className="space-y-4">
            <Header title="Danger Zone" detail="High-impact account operations." />
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="mb-3 flex items-center gap-2 font-bold text-red-700"><AlertTriangle size={18} /> Careful actions</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => savePatch({ isActive: false, status: "DISABLED" })}>Disconnect Account</button>
                <button className="btn-secondary" disabled>Delete Account</button>
                <button className="btn-secondary" disabled>Delete Imported Emails</button>
                <button className="btn-secondary" disabled>Rebuild Index</button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      </section>
    </div>
  );
}

function Header({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words text-sm font-bold">{value}</div>
    </div>
  );
}

function FiltersPanel({ account, onSave, loading }: { account: any; onSave: (payload: Record<string, unknown>) => void; loading: boolean }) {
  const [excludedDomains, setExcludedDomains] = useState((account.excludedDomains || []).join("\n"));
  const [excludedEmails, setExcludedEmails] = useState((account.excludedEmails || []).join("\n"));
  const [internalDomain, setInternalDomain] = useState(account.internalDomain || "aresourcepool.com");
  return (
    <div className="space-y-4">
      <Header title="Filters" detail="Excluded domains, emails, internal domains, and detection rules." />
      <Textarea label="Excluded Domains" value={excludedDomains} onChange={setExcludedDomains} />
      <Textarea label="Excluded Emails" value={excludedEmails} onChange={setExcludedEmails} />
      <label className="block text-sm"><span className="font-semibold text-muted">Internal Domain</span><input className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={internalDomain} onChange={(event) => setInternalDomain(event.target.value)} /></label>
      <div className="grid gap-3 md:grid-cols-2"><Info label="Spam Detection" value="Enabled" /><Info label="Bounce Detection" value="Enabled" /></div>
      <button className="btn-primary inline-flex items-center gap-2" onClick={() => onSave({ excludedDomains: lines(excludedDomains), excludedEmails: lines(excludedEmails), internalDomain })} disabled={loading}>
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Filters
      </button>
    </div>
  );
}

function SchedulerPanel({ config, onSave, loading }: { config: Record<string, any>; onSave: (payload: Record<string, unknown>) => void; loading: boolean }) {
  const [syncInterval, setSyncInterval] = useState(config.syncInterval || config.interval || "MANUAL");
  const [batchSize, setBatchSize] = useState(Number(config.batchSize || 100));
  const [concurrency, setConcurrency] = useState(Number(config.concurrency || 2));
  const [autoImport, setAutoImport] = useState(Boolean(config.autoImport ?? config.autoSyncEnabled ?? syncInterval !== "MANUAL"));
  return (
    <div className="space-y-4">
      <Header title="Scheduler" detail="Account-specific sync interval and auto import behavior." />
      <label className="block text-sm">
        <span className="font-semibold text-muted">Sync Interval</span>
        <select className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={syncInterval} onChange={(event) => setSyncInterval(event.target.value)}>
          {intervals.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold text-muted">Batch Size</span>
          <select className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))}>
            {batchSizes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-muted">Folder Concurrency</span>
          <select className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>
            {concurrencyOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-3 rounded-lg border border-line bg-subtle p-4 text-sm font-semibold">
        <input type="checkbox" checked={autoImport} onChange={(event) => setAutoImport(event.target.checked)} />
        Auto Sync
      </label>
      <button className="btn-primary inline-flex items-center gap-2" onClick={() => onSave({ schedulerConfig: { syncInterval, batchSize, concurrency, autoImport, autoSyncEnabled: autoImport }, autoSyncEnabled: autoImport && syncInterval !== "MANUAL" })} disabled={loading}>
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Scheduler
      </button>
    </div>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm"><span className="font-semibold text-muted">{label}</span><textarea className="mt-1 min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function parseObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function lines(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function progress(job: any) {
  const total = Math.max(1, job.importedCount + job.skippedCount + job.errorCount + 1);
  if (job.status === "COMPLETED") return 100;
  return Math.min(95, Math.round(((job.importedCount + job.skippedCount + job.errorCount) / total) * 100));
}
