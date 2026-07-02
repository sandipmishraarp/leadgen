"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Gauge,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle
} from "lucide-react";
import { ClientDateTime } from "@/components/ClientDateTime";

type Snapshot = {
  generatedAt: string | Date;
  summary: Record<string, number>;
  liveMonitor: any;
  accounts: any[];
  jobs: any[];
  folderStates: any[];
  activity: any[];
  failedJobs: any[];
};

export function SyncCenterDashboard({ initialSnapshot }: { initialSnapshot: Snapshot }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState(initialSnapshot.accounts[0]?.id || "");
  const [toast, setToast] = useState<any | null>(null);
  const completedSeen = useRef(new Set((initialSnapshot.jobs || []).filter((job) => job.status === "COMPLETED").map((job) => job.id)));

  async function refresh() {
    const response = await apiFetch("/api/sync-center", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to refresh Sync Center.");
    setSnapshot(data);
    const newCompleted = (data.jobs || []).find((job: any) => job.status === "COMPLETED" && !completedSeen.current.has(job.id));
    for (const job of data.jobs || []) {
      if (job.status === "COMPLETED") completedSeen.current.add(job.id);
    }
    if (newCompleted) {
      setToast({
        title: "Sync Complete",
        detail: `${newCompleted.emailsNew} emails imported, ${newCompleted.duplicateEmails} duplicates skipped, ${newCompleted.leadsCreated} leads created, ${newCompleted.leadsUpdated} leads updated. Completed in ${durationText(newCompleted.startedAt, newCompleted.completedAt)}.`
      });
      window.setTimeout(() => setToast(null), 7000);
    }
  }

  async function postAction(action: string, url: string) {
    setBusy(action);
    try {
      const response = await fetch(url, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Action failed.");
      await refresh();
    } catch (error) {
      setToast({ title: "Sync action failed", detail: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => null);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const live = snapshot.liveMonitor || {};
  const isRunning = live.status === "RUNNING";
  const failedJobs = snapshot.failedJobs || [];

  return (
    <div className="space-y-6">
      {toast ? (
        <div className="fixed right-5 top-20 z-50 max-w-md rounded-xl border border-emerald-200 bg-white p-4 shadow-soft">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
            <div>
              <div className="font-bold">{toast.title}</div>
              <div className="mt-1 text-sm leading-5 text-muted">{toast.detail}</div>
            </div>
          </div>
        </div>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
            <Activity size={14} className="text-accent" />
            Live sync operations
          </div>
          <h1 className="page-title">Sync Center</h1>
          <p className="mt-1 text-sm text-muted">Live monitor for email imports, duplicates, lead intake, folder progress, and failures.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-semibold"
            value={selectedAccountId}
            onChange={(event) => setSelectedAccountId(event.target.value)}
          >
            {snapshot.accounts.map((account) => <option key={account.id} value={account.id}>{account.mailbox}</option>)}
          </select>
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => selectedAccountId && postAction("selected", `/api/email-accounts/${selectedAccountId}/sync`)} disabled={!selectedAccountId || Boolean(busy)}>
            {busy === "selected" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Sync Selected Account
          </button>
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => postAction("all", "/api/sync-center/run")} disabled={Boolean(busy)}>
            {busy === "all" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Sync All
          </button>
        </div>
      </header>

      <SummaryCards summary={snapshot.summary} />

      <section className="premium-card overflow-hidden">
        <div className="border-b border-line p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Live Sync Monitor</h2>
              <p className="mt-1 text-sm text-muted">Updates every 2 seconds. Shows what is happening right now.</p>
            </div>
            <StatusBadge status={live.status || "IDLE"} />
          </div>
        </div>
        {isRunning ? (
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <InfoBox label="Current account" value={live.accountEmail} />
                <InfoBox label="Current folder" value={live.folder || "Multiple folders"} />
                <InfoBox label="Current job type" value={live.jobType} />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-sm font-semibold">
                  <span>Progress</span>
                  <span>{live.progressPercent || 0}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${live.progressPercent || 0}%` }} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Processed emails" value={live.processedEmails || 0} />
                <Metric label="Remaining emails" value={live.remainingEmails || 0} />
                <Metric label="New emails" value={live.emailsNew || 0} />
                <Metric label="Duplicate emails" value={live.duplicateEmails || 0} />
                <Metric label="Leads created" value={live.leadsCreated || 0} />
                <Metric label="Leads updated" value={live.leadsUpdated || 0} />
                <Metric label="Parse failures" value={live.parseFailed || 0} />
                <Metric label="Speed" value={`${live.speedPerMinute || 0}/min`} />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-subtle p-4">
              <div className="mb-3 font-bold">Running Job Controls</div>
              <div className="space-y-2">
                <JobActionButton icon={<PauseCircle size={15} />} label="Pause" onClick={() => postAction(`pause-${live.id}`, `/api/sync-center/jobs/${live.id}/pause`)} busy={busy === `pause-${live.id}`} />
                <JobActionButton icon={<Play size={15} />} label="Resume" onClick={() => postAction(`resume-${live.id}`, `/api/sync-center/jobs/${live.id}/resume`)} busy={busy === `resume-${live.id}`} />
                <JobActionButton icon={<RotateCcw size={15} />} label="Retry" onClick={() => postAction(`retry-${live.id}`, `/api/sync-center/jobs/${live.id}/retry`)} busy={busy === `retry-${live.id}`} />
                <JobActionButton icon={<XCircle size={15} />} label="Cancel" onClick={() => postAction(`cancel-${live.id}`, `/api/sync-center/jobs/${live.id}/cancel`)} busy={busy === `cancel-${live.id}`} />
              </div>
              <div className="mt-4 text-sm text-muted">
                Estimated remaining: <span className="font-semibold text-ink">{secondsText(live.estimatedRemainingSeconds)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="rounded-xl border border-dashed border-line bg-subtle p-6 text-sm text-muted">
              <div className="font-bold text-ink">No sync currently running.</div>
              <div className="mt-2">Last sync: <ClientDateTime value={live.lastSync} fallback="Never" timeStyle="short" /></div>
              <div className="mt-1">Next auto sync: <ClientDateTime value={live.nextAutoSync} fallback="Manual" timeStyle="short" /></div>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
        <JobsTable jobs={snapshot.jobs || []} busy={busy} postAction={postAction} />
        <LiveActivityLog activity={snapshot.activity || []} />
      </div>

      <AccountStatusGrid accounts={snapshot.accounts || []} />
      <FailedJobs jobs={failedJobs} busy={busy} postAction={postAction} />
      <FolderStates folders={snapshot.folderStates || []} />
    </div>
  );
}

function SummaryCards({ summary }: { summary: Record<string, number> }) {
  return (
    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
      <SummaryCard icon={<Activity size={17} />} label="Emails Imported Today" value={summary.emailsImportedToday || 0} />
      <SummaryCard icon={<Copy size={17} />} label="Duplicate Emails" value={summary.duplicateEmails || 0} />
      <SummaryCard icon={<CheckCircle2 size={17} />} label="Leads Created Today" value={summary.leadsCreatedToday || 0} />
      <SummaryCard icon={<RefreshCw size={17} />} label="Leads Updated Today" value={summary.leadsUpdatedToday || 0} />
      <SummaryCard icon={<AlertTriangle size={17} />} label="Parse Failures" value={summary.parseFailuresToday || 0} />
      <SummaryCard icon={<XCircle size={17} />} label="Failed Jobs" value={summary.failedJobsToday || 0} />
      <SummaryCard icon={<Play size={17} />} label="Running Jobs" value={summary.runningJobs || 0} />
      <SummaryCard icon={<Gauge size={17} />} label="Average Speed" value={`${summary.averageImportSpeed || 0}/min`} />
    </div>
  );
}

function JobsTable({ jobs, busy, postAction }: { jobs: any[]; busy: string | null; postAction: (action: string, url: string) => Promise<void> }) {
  return (
    <section className="premium-card overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="text-lg font-bold">Recent Jobs</h2>
        <p className="mt-1 text-sm text-muted">Emails are shown as New / Duplicate / Failed, so skipped means duplicate.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Account</th>
              <th className="px-3 py-3">Folder</th>
              <th className="px-3 py-3">Job Type</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Emails</th>
              <th className="px-3 py-3">Leads Created</th>
              <th className="px-3 py-3">Leads Updated</th>
              <th className="px-3 py-3">Leads Merged</th>
              <th className="px-3 py-3">Parse Failed</th>
              <th className="px-3 py-3">Speed</th>
              <th className="px-3 py-3">Updated</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {jobs.map((job) => (
              <tr key={job.id} className={job.status === "FAILED" ? "bg-red-50/40" : undefined}>
                <td className="px-3 py-3 font-medium">{job.accountEmail}</td>
                <td className="px-3 py-3">{job.folder}</td>
                <td className="px-3 py-3">{job.jobType}<div className="text-xs text-muted">{job.triggerType}</div></td>
                <td className="px-3 py-3"><StatusBadge status={job.status} /></td>
                <td className="px-3 py-3">
                  <div>{job.emailsNew} New</div>
                  <div className="text-muted">{job.duplicateEmails} Duplicate</div>
                  <div className={job.emailErrors ? "text-red-700" : "text-muted"}>{job.emailErrors} Failed</div>
                </td>
                <td className="px-3 py-3">{job.leadsCreated}</td>
                <td className="px-3 py-3">{job.leadsUpdated}</td>
                <td className="px-3 py-3">{job.leadsMerged}</td>
                <td className="px-3 py-3">{job.parseFailed}</td>
                <td className="px-3 py-3">{job.speedPerMinute || 0}/min</td>
                <td className="px-3 py-3"><ClientDateTime value={job.updatedAt} timeStyle="short" /></td>
                <td className="px-3 py-3">
                  <button className="text-xs font-bold text-accent" onClick={() => postAction(`retry-${job.id}`, `/api/sync-center/jobs/${job.id}/retry`)} disabled={Boolean(busy)}>
                    Retry
                  </button>
                </td>
              </tr>
            ))}
            {!jobs.length ? <tr><td className="px-3 py-8 text-center text-muted" colSpan={12}>No sync jobs yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LiveActivityLog({ activity }: { activity: any[] }) {
  return (
    <section className="premium-card overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="text-lg font-bold">Live Import Log</h2>
        <p className="mt-1 text-sm text-muted">Newest activity appears first.</p>
      </div>
      <div className="max-h-[520px] overflow-auto p-4">
        <div className="space-y-3">
          {activity.map((event) => (
            <div key={event.id} className="rounded-lg border border-line bg-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{event.title}</div>
                  <div className="mt-1 text-sm text-muted">{event.detail}</div>
                </div>
                <div className="shrink-0 text-xs font-semibold text-muted"><ClientDateTime value={event.time} timeStyle="short" /></div>
              </div>
            </div>
          ))}
          {!activity.length ? <div className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">No sync activity yet.</div> : null}
        </div>
      </div>
    </section>
  );
}

function AccountStatusGrid({ accounts }: { accounts: any[] }) {
  return (
    <section className="premium-card p-5">
      <h2 className="mb-4 text-lg font-bold">Account Status</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-xl border border-line bg-subtle p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold">{account.mailbox}</div>
                <div className="mt-1 text-sm text-muted">{account.role}</div>
              </div>
              <StatusBadge status={account.currentStatus} />
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <InfoBox label="Auto Sync Enabled" value={account.autoSyncEnabled ? "Yes" : "No"} />
              <InfoBox label="Last Email Sync" value={<ClientDateTime value={account.lastEmailSync} fallback="Never" timeStyle="short" />} />
              <InfoBox label="Last Lead Parse" value={<ClientDateTime value={account.lastLeadParse} fallback="Never" timeStyle="short" />} />
              <InfoBox label="Last Lead Created" value={<ClientDateTime value={account.lastLeadCreated} fallback="Never" timeStyle="short" />} />
              <InfoBox label="Next Auto Sync" value={<ClientDateTime value={account.nextAutoSync} fallback="Manual" timeStyle="short" />} />
              <InfoBox label="Folders Monitored" value={account.foldersMonitored} />
              <InfoBox label="Total Emails Imported" value={account.totalEmailsImported} />
              <InfoBox label="Total Leads" value={account.totalLeads} />
              <InfoBox label="Failed Folders" value={account.failedFolders?.length || 0} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FailedJobs({ jobs, busy, postAction }: { jobs: any[]; busy: string | null; postAction: (action: string, url: string) => Promise<void> }) {
  if (!jobs.length) return null;
  return (
    <section className="premium-card p-5">
      <h2 className="mb-4 text-lg font-bold">Failed Job Details</h2>
      <div className="space-y-3">
        {jobs.map((job) => (
          <details key={job.id} className="rounded-xl border border-red-200 bg-red-50 p-4">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-red-800">{job.accountEmail}</div>
                  <div className="mt-1 text-sm text-red-700">{job.folder} · <ClientDateTime value={job.updatedAt} timeStyle="short" /></div>
                </div>
                <StatusBadge status="FAILED" />
              </div>
            </summary>
            <div className="mt-4 rounded-lg bg-white p-3 text-sm">
              <div className="mb-2 font-semibold">Actual error message</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-subtle p-3 text-xs text-red-800">{job.lastError || "No error message stored."}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-secondary inline-flex items-center gap-2" onClick={() => postAction(`retry-${job.id}`, `/api/sync-center/jobs/${job.id}/retry`)} disabled={Boolean(busy)}>
                  <RotateCcw size={15} /> Retry
                </button>
                <button className="btn-secondary inline-flex items-center gap-2" onClick={() => navigator.clipboard?.writeText(job.lastError || "")}>
                  <Copy size={15} /> Copy Error
                </button>
                <span className="inline-flex items-center rounded-lg border border-line bg-subtle px-3 text-xs font-semibold text-muted">View Details</span>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function FolderStates({ folders }: { folders: any[] }) {
  return (
    <section className="premium-card p-5">
      <h2 className="mb-4 text-lg font-bold">Folder Progress</h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Account</th>
              <th className="px-3 py-3">Folder</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">UID</th>
              <th className="px-3 py-3">Emails</th>
              <th className="px-3 py-3">Last Sync</th>
              <th className="px-3 py-3">Failure Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {folders.map((folder) => (
              <tr key={folder.id}>
                <td className="px-3 py-3 font-medium">{folder.accountEmail}</td>
                <td className="px-3 py-3">{folder.folderPath}</td>
                <td className="px-3 py-3"><StatusBadge status={folder.status} /></td>
                <td className="px-3 py-3">{folder.lastUid} / {folder.highestUid}</td>
                <td className="px-3 py-3">{folder.importedCount} new · {folder.skippedCount} duplicate · {folder.errorCount} failed</td>
                <td className="px-3 py-3"><ClientDateTime value={folder.lastSyncedAt} fallback="Never" timeStyle="short" /></td>
                <td className="px-3 py-3 text-red-700">{folder.lastError || "--"}</td>
              </tr>
            ))}
            {!folders.length ? <tr><td className="px-3 py-8 text-center text-muted" colSpan={7}>No folder sync state yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="premium-card p-4">
      <div className="mb-2 flex items-center gap-2 text-muted">{icon}<span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span></div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words font-semibold">{value || "--"}</div>
    </div>
  );
}

function JobActionButton({ icon, label, busy, onClick }: { icon: React.ReactNode; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button className="btn-secondary inline-flex w-full items-center justify-center gap-2" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || "IDLE").toUpperCase();
  const tone =
    normalized === "FAILED" || normalized === "ERROR" ? "border-red-200 bg-red-50 text-red-700" :
    normalized === "RUNNING" ? "border-blue-200 bg-blue-50 text-blue-700" :
    normalized === "PAUSED" || normalized === "IDLE" ? "border-amber-200 bg-amber-50 text-amber-700" :
    "border-emerald-200 bg-emerald-50 text-emerald-700";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}>{normalized.replaceAll("_", " ")}</span>;
}

function secondsText(seconds: number) {
  if (!seconds) return "--";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function durationText(start?: string | null, end?: string | null) {
  if (!start || !end) return "--";
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return secondsText(seconds);
}
