"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { ClientDateTime } from "@/components/ClientDateTime";

type Account = {
  id: string;
  emailAddress: string;
  lastSyncedAt: string | Date | null;
};

type FolderNode = {
  name: string;
  path: string;
  selectable: boolean;
  sourceProviderName: string | null;
  children: FolderNode[];
};

type ImportFolder = {
  id: string;
  folderPath: string;
  status: string;
  lastUidImported: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  updatedAt?: string | Date;
  lastError: string | null;
};

type ImportJob = {
  id: string;
  accountEmail: string;
  status: string;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  currentFolderPath: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  updatedAt?: string | Date;
  lastError: string | null;
  folders: ImportFolder[];
};

export function LeadImportPanel({ accounts, initialJobs }: { accounts: Account[]; initialJobs: ImportJob[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>(initialJobs);
  const [activeJob, setActiveJob] = useState<ImportJob | null>(initialJobs.find((job) => ["RUNNING", "PENDING", "PAUSED"].includes(job.status)) || initialJobs[0] || null);
  const [batchSize, setBatchSize] = useState(50);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const jobFolderRows = activeJob?.folders || [];
  const folderStatus = useMemo(() => new Map(jobFolderRows.map((folder) => [folder.folderPath, folder])), [jobFolderRows]);
  const visibleFolders = flatFolders.length ? folders : foldersFromJob(activeJob);
  const visibleFlatFolders = flatFolders.length ? flatFolders : flattenFolders(visibleFolders);
  const currentJob = activeJob && ["RUNNING", "PENDING", "PAUSED"].includes(activeJob.status) ? activeJob : null;
  const currentAction = activeJob ? currentActionText(activeJob) : "No import running";
  const lastUpdateSeconds = activeJob?.updatedAt ? Math.max(0, Math.floor((now - new Date(activeJob.updatedAt).getTime()) / 1000)) : null;
  const stuck = Boolean(currentJob && lastUpdateSeconds !== null && lastUpdateSeconds >= 60);
  const liveEvents = activeJob ? buildLiveEvents(activeJob) : [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeJob?.id || !["RUNNING", "PENDING"].includes(activeJob.status)) return;
    const timer = window.setInterval(async () => {
      const response = await apiFetch(`/api/lead-import/jobs/${activeJob.id}`);
      const data = await response.json().catch(() => null);
      if (response.ok && data?.job) {
        setActiveJob(data.job);
        setJobs((current) => current.map((job) => (job.id === data.job.id ? data.job : job)));
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  useEffect(() => {
    if (!activeJob?.id || busy || !["RUNNING", "PENDING"].includes(activeJob.status)) return;
    const hasPendingWork = activeJob.folders.some((folder) => !["COMPLETED", "FAILED", "STALE", "STOPPED"].includes(folder.status));
    if (!hasPendingWork) return;
    const timer = window.setTimeout(() => runJob(activeJob.id), 2500);
    return () => window.clearTimeout(timer);
  }, [activeJob?.id, activeJob?.status, activeJob?.updatedAt, busy]);

  async function loadFolders() {
    if (!accountId) return;
    setBusy(true);
    setMessage("");
    const response = await apiFetch(`/api/email-accounts/${accountId}/folders`);
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to load folders");
      return;
    }
    setFolders(data.folders || []);
    setSelected((data.flatFolders || []).filter((folder: FolderNode) => folder.selectable).map((folder: FolderNode) => folder.path));
    setMessage("Folders loaded");
  }

  async function createJob(paths: string[]) {
    if (!accountId || paths.length === 0) {
      setMessage("Select at least one folder");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await apiFetch("/api/lead-import/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, folderPaths: paths, batchSize })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to create import job");
      return;
    }
    setActiveJob(data.job);
    setJobs([data.job, ...jobs]);
    setMessage("Processing next folder automatically...");
    await runJob(data.job.id);
  }

  async function refreshJobs() {
    const response = await apiFetch("/api/lead-import/jobs");
    const data = await response.json();
    if (response.ok) {
      setJobs(data.jobs || []);
      const next = (data.jobs || []).find((job: ImportJob) => job.id === activeJob?.id) || data.jobs?.[0] || null;
      setActiveJob(next);
    }
  }

  async function runJob(jobId = activeJob?.id) {
    if (!jobId) return;
    setBusy(true);
    setMessage("");
    const response = await apiFetch(`/api/lead-import/jobs/${jobId}/run`, { method: "POST" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to run import");
      return;
    }
    setActiveJob(data.job);
    setJobs((current) => current.map((job) => (job.id === data.job.id ? data.job : job)));
    setMessage(data.job.status === "COMPLETED" ? (data.job.lastError || "Import completed") : data.job.lastError || "Processing next folder automatically...");
  }

  async function updateJob(action: "pause" | "resume") {
    if (!activeJob) return;
    setBusy(true);
    const response = await apiFetch(`/api/lead-import/jobs/${activeJob.id}/${action}`, { method: "POST" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || `Unable to ${action} job`);
      return;
    }
    setActiveJob(data.job);
    setJobs((current) => current.map((job) => (job.id === data.job.id ? data.job : job)));
    setMessage(`Job ${action}d`);
  }

  async function jobAction(action: "stop" | "retry") {
    if (!activeJob) return;
    setBusy(true);
    const response = await apiFetch(`/api/lead-import/jobs/${activeJob.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || `Unable to ${action} job`);
      return;
    }
    setActiveJob(data.job);
    setJobs((current) => current.map((job) => (job.id === data.job.id ? data.job : job)));
    setMessage(action === "stop" ? "Job stopped" : "Failed job reset for retry");
  }

  async function clearCompleted() {
    if (!accountId) return;
    setBusy(true);
    const response = await apiFetch(`/api/lead-import/jobs?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to clear completed jobs");
      return;
    }
    setJobs((current) => current.filter((job) => !["COMPLETED", "FAILED", "STALE", "STOPPED"].includes(job.status)));
    setMessage(`Cleared ${data.updated || 0} completed job(s)`);
  }

  function toggle(path: string) {
    setSelected((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_160px_auto_auto]">
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-10 rounded-md border border-line px-3">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.emailAddress}
              </option>
            ))}
          </select>
          <select value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} className="h-10 rounded-md border border-line px-3">
            {[25, 50, 100, 250, 500].map((size) => (
              <option key={size} value={size}>
                Batch {size}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={loadFolders} disabled={busy || !accountId}>
            Discover Folders
          </Button>
          <Button type="button" onClick={() => createJob(selected)} disabled={busy || selected.length === 0}>
            Import Selected
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={() => setSelected(visibleFlatFolders.map((folder) => folder.path))} disabled={!visibleFlatFolders.length}>
            Select All
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSelected([])} disabled={!selected.length}>
            Clear
          </Button>
          <Button type="button" variant="secondary" onClick={() => createJob(selected.length ? selected : visibleFlatFolders.map((folder) => folder.path))} disabled={busy || !visibleFlatFolders.length}>
            Import All New
          </Button>
          <Button type="button" variant="secondary" onClick={() => createJob(visibleFlatFolders.map((folder) => folder.path))} disabled={busy || !visibleFlatFolders.length}>
            Full Historical Import
          </Button>
          <Button type="button" variant="secondary" onClick={refreshJobs} disabled={busy}>Refresh</Button>
          <Button type="button" variant="secondary" onClick={clearCompleted} disabled={busy}>Clear Completed Jobs</Button>
          {message ? <span className="text-sm text-slate-600">{message}</span> : null}
        </div>
        <p className="mt-3 text-xs text-amber-700">
          Full Historical Import may take time. Latest leads should be synced from Lead Intake Quick Sync.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="mb-4 font-bold">Folder Tree</h2>
          {visibleFolders.length ? (
            <div className="space-y-1">{visibleFolders.map((folder) => renderFolder(folder, selected, toggle, folderStatus))}</div>
          ) : (
            <div className="space-y-3 text-sm text-slate-500">
              <div>Folders are not discovered yet.</div>
              <Button type="button" variant="secondary" onClick={loadFolders} disabled={busy || !accountId}>Discover Folders</Button>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">Current Import Job</h2>
            {activeJob ? <span className="rounded-md bg-slate-100 px-3 py-1 text-sm">{activeJob.status}</span> : null}
          </div>
          {activeJob ? (
            <div className="space-y-4">
              <div className="rounded-md border border-line bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`h-2.5 w-2.5 rounded-full ${currentJob ? "animate-pulse bg-emerald-500" : "bg-slate-300"}`} />
                    {currentJob ? "Live importing" : activeJob.status}
                  </div>
                  <div className="text-xs text-slate-500">
                    Last update: {lastUpdateSeconds === null ? "Not started" : `${lastUpdateSeconds} seconds ago`}
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-700">{currentAction}</div>
                {lastProcessedFolder(activeJob) ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Last processed: {lastProcessedFolder(activeJob)?.folderPath} · {lastProcessedFolder(activeJob)?.lastError || "Folder updated"}
                  </div>
                ) : null}
                {stuck ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No progress in the last 60 seconds. Import may be stuck.
                  </div>
                ) : null}
              </div>
              {!currentJob ? (
                <div className="rounded-md border border-line bg-slate-50 p-3 text-sm text-slate-600">
                  No import running. Choose folders and start import.
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Emails imported" value={activeJob.importedCount} />
                <Metric label="Skipped duplicates" value={activeJob.skippedCount} />
                <Metric label="Errors" value={activeJob.errorCount} />
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-accent" style={{ width: `${progressPercent(activeJob)}%` }} />
              </div>
              <div className="text-xs font-medium text-slate-500">
                {processedCount(activeJob)} processed so far
              </div>
              <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                <div>Current folder: <strong>{activeJob.currentFolderPath || "Not started"}</strong></div>
                <div>Processed emails: <strong>{processedCount(activeJob)}</strong></div>
                <div>Leads created: <strong>{activeJob.importedCount}</strong></div>
                <div>Leads updated: <strong>0</strong></div>
                <div>Speed: <strong>{speedPerMinute(activeJob)} emails/min</strong></div>
                <div>Heavy folder mode: <strong>{isHeavyActiveFolder(activeJob) ? "Enabled" : "Normal"}</strong></div>
                <div>Last saved cursor: <strong>{lastProcessedFolder(activeJob)?.lastUidImported || 0}</strong></div>
                <div>Resume point: <strong>{lastProcessedFolder(activeJob)?.lastUidImported || "Not started"}</strong></div>
                <div>Last progress: {activeJob.updatedAt ? <ClientDateTime value={activeJob.updatedAt} timeStyle="medium" /> : "Not started"}</div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={() => runJob()} disabled={busy || activeJob.status === "COMPLETED" || activeJob.status === "PAUSED"}>
                  Run Next Batch
                </Button>
                <Button type="button" variant="secondary" onClick={() => updateJob("pause")} disabled={busy || activeJob.status === "PAUSED" || activeJob.status === "COMPLETED"}>
                  Pause
                </Button>
                <Button type="button" variant="secondary" onClick={() => updateJob("resume")} disabled={busy || activeJob.status !== "PAUSED"}>
                  Resume
                </Button>
                <Button type="button" variant="secondary" onClick={() => jobAction("stop")} disabled={busy || ["COMPLETED", "STOPPED", "ARCHIVED"].includes(activeJob.status)}>
                  Stop
                </Button>
                <Button type="button" variant="secondary" onClick={() => jobAction("retry")} disabled={busy || !["FAILED", "STALE", "STOPPED"].includes(activeJob.status)}>
                  Retry Failed
                </Button>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border border-line">
                {activeJob.folders.map((folder) => (
                  <div key={folder.id} className="grid grid-cols-[1fr_100px_90px_90px_90px] gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0">
                    <span className="truncate">{folder.folderPath}</span>
                    <span><StatusBadge status={folder.status} /></span>
                    <span>{folder.importedCount}</span>
                    <span>{folder.skippedCount}</span>
                    <span>{folder.errorCount}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-line bg-slate-50">
                <div className="border-b border-line px-3 py-2 text-sm font-semibold">Live mini log</div>
                <div className="max-h-56 overflow-auto divide-y divide-line">
                  {liveEvents.map((event) => (
                    <div key={event.id} className="px-3 py-2 text-xs text-slate-600">
                      <span className="font-mono text-slate-400">{event.time}</span> {event.message}
                    </div>
                  ))}
                  {!liveEvents.length ? <div className="px-3 py-3 text-xs text-slate-500">No activity yet.</div> : null}
                </div>
              </div>
              {activeJob.lastError ? <div className="text-sm text-red-600">{activeJob.lastError}</div> : null}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No import running. Choose folders and start import.</div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-4 font-bold">Recent Jobs</h2>
        <div className="overflow-auto">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[1.1fr_120px_1fr_120px_160px_150px_140px_130px] gap-3 border-b border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
            <span>Account</span>
            <span>Job type</span>
            <span>Folder</span>
            <span>Status</span>
            <span>Emails new / skipped / errors</span>
            <span>Leads created / updated</span>
            <span>Last progress</span>
            <span>Action</span>
          </div>
          {jobs.map((job) => (
            <button key={job.id} type="button" onClick={() => setActiveJob(job)} className="grid w-full grid-cols-[1.1fr_120px_1fr_120px_160px_150px_140px_130px] gap-3 border-b border-line px-3 py-3 text-left text-sm">
              <span>{job.accountEmail}</span>
              <span>Lead Import</span>
              <span className="truncate">{job.currentFolderPath || job.folders.find((folder) => folder.status === "RUNNING")?.folderPath || "Multiple folders"}</span>
              <span><StatusBadge status={job.status} /></span>
              <span>{job.importedCount} / {job.skippedCount} / {job.errorCount}</span>
              <span>{job.importedCount} / 0</span>
              <span>{job.updatedAt ? <ClientDateTime value={job.updatedAt} timeStyle="short" /> : "Not started"}</span>
              <span>{["FAILED", "STALE", "STOPPED"].includes(job.status) ? "Retry available" : "Open"}</span>
            </button>
          ))}
          {!jobs.length ? <div className="text-sm text-slate-500">No jobs created yet.</div> : null}
        </div>
        </div>
      </section>
    </div>
  );
}

function renderFolder(folder: FolderNode, selected: string[], toggle: (path: string) => void, statusMap: Map<string, ImportFolder>, depth = 0) {
  const status = statusMap.get(folder.path);
  return (
    <div key={folder.path}>
      <label className="flex flex-wrap items-center gap-2 text-sm" style={{ paddingLeft: depth * 16 }}>
        <input type="checkbox" checked={selected.includes(folder.path)} disabled={!folder.selectable} onChange={() => toggle(folder.path)} />
        <span>{folder.name}</span>
        <span className="text-xs text-slate-400">{folder.path}</span>
        {folder.sourceProviderName ? <span className="text-xs text-accent">{folder.sourceProviderName}</span> : null}
        {status ? (
          <>
            <StatusBadge status={status.status} />
            <span className="text-xs text-slate-500">{status.importedCount} new / {status.skippedCount} skipped / {status.errorCount} errors</span>
          </>
        ) : null}
      </label>
      {folder.children.map((child) => renderFolder(child, selected, toggle, statusMap, depth + 1))}
    </div>
  );
}

function flattenFolders(folders: FolderNode[]) {
  return folders.flatMap((folder): FolderNode[] => [
    ...(folder.selectable ? [folder] : []),
    ...flattenFolders(folder.children)
  ]);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : status === "FAILED" || status === "STALE" ? "bg-red-50 text-red-700" : status === "RUNNING" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{status}</span>;
}

function foldersFromJob(job: ImportJob | null): FolderNode[] {
  if (!job?.folders?.length) return [];
  return job.folders.map((folder) => ({
    name: folder.folderPath.split("/").filter(Boolean).pop() || folder.folderPath,
    path: folder.folderPath,
    selectable: true,
    sourceProviderName: null,
    children: []
  }));
}

function processedCount(job: ImportJob) {
  return Number(job.importedCount || 0) + Number(job.skippedCount || 0) + Number(job.errorCount || 0);
}

function progressPercent(job: ImportJob) {
  if (!job.folders.length) return 0;
  const done = job.folders.filter((folder) => ["COMPLETED", "FAILED", "STALE", "STOPPED"].includes(folder.status)).length;
  return Math.round((done / job.folders.length) * 100);
}

function speedPerMinute(job: ImportJob) {
  if (!job.startedAt) return 0;
  const start = new Date(job.startedAt).getTime();
  const end = job.updatedAt ? new Date(job.updatedAt).getTime() : Date.now();
  const minutes = Math.max((end - start) / 60000, 1 / 60);
  return Math.round((processedCount(job) / minutes) * 10) / 10;
}

function currentActionText(job: ImportJob) {
  if (job.status === "COMPLETED") return "Import completed";
  if (job.status === "PAUSED") return "Import paused";
  if (job.status === "FAILED" || job.status === "STALE") return job.lastError || "Import needs attention";
  const runningFolder = job.folders.find((folder) => folder.status === "RUNNING");
  const pendingFolder = job.folders.find((folder) => folder.status === "PENDING");
  if (!job.startedAt) return "Connecting to IMAP";
  if (runningFolder) return `Processing email batch in ${runningFolder.folderPath}`;
  if (job.currentFolderPath) return `Opening folder ${job.currentFolderPath}`;
  if (pendingFolder) return `Moving to next folder ${pendingFolder.folderPath}`;
  return "Creating leads";
}

function lastProcessedFolder(job: ImportJob) {
  return [...job.folders]
    .filter((folder) => folder.updatedAt)
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0] || null;
}

function isHeavyActiveFolder(job: ImportJob) {
  const folder = job.currentFolderPath || lastProcessedFolder(job)?.folderPath || "";
  return /^inbox$/i.test(folder) || /heavy folder mode/i.test(lastProcessedFolder(job)?.lastError || "");
}

function buildLiveEvents(job: ImportJob) {
  const events = job.folders
    .filter((folder) => folder.updatedAt)
    .flatMap((folder) => {
      const time = new Date(folder.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour12: false });
      const messages = [];
      if (folder.importedCount > 0) messages.push(`${time} Imported ${folder.importedCount} email(s) from ${folder.folderPath}`);
      if (folder.importedCount > 0) messages.push(`${time} Created lead(s) from ${folder.folderPath}`);
      if (folder.skippedCount > 0) messages.push(`${time} Skipped ${folder.skippedCount} duplicate email(s) in ${folder.folderPath}`);
      if (folder.errorCount > 0) messages.push(`${time} ${folder.errorCount} error(s) in ${folder.folderPath}`);
      if (folder.status === "COMPLETED") messages.push(`${time} Folder completed: ${folder.folderPath}`);
      if (!messages.length) messages.push(`${time} ${folder.status}: ${folder.folderPath}`);
      return messages.map((message, index) => ({ id: `${folder.id}-${index}-${message}`, time, message: message.replace(`${time} `, "") }));
    })
    .reverse()
    .slice(0, 10);
  if (job.status === "COMPLETED") {
    events.unshift({ id: `${job.id}-completed`, time: new Date(job.completedAt || job.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour12: false }), message: "Import completed" });
  }
  return events.slice(0, 10);
}
