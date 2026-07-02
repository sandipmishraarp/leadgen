"use client";

import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FolderTree, Loader2, PlugZap, Save } from "lucide-react";

const roles = ["Lead Intake", "Sales", "Marketing", "Support", "Admin", "Custom"];
const ranges = ["Last 30 Days", "Last 90 Days", "Last Year", "Everything", "Custom Date Range"];
const intervals = ["Manual", "Every 5 Minutes", "15 Minutes", "30 Minutes", "1 Hour", "6 Hours", "Daily"];

type FolderNode = {
  name: string;
  path: string;
  selectable: boolean;
  children: FolderNode[];
};

type FormState = {
  emailAddress: string;
  role: string;
  accountName: string;
  description: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  username: string;
  password: string;
  selectedFolders: string[];
  importRange: string;
  customDateFrom: string;
  customDateTo: string;
  syncInterval: string;
  autoImport: boolean;
};

export function EmailAccountWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    emailAddress: "",
    role: "Lead Intake",
    accountName: "",
    description: "",
    imapHost: "",
    imapPort: "993",
    smtpHost: "",
    smtpPort: "465",
    username: "",
    password: "",
    selectedFolders: [],
    importRange: "Last 30 Days",
    customDateFrom: "",
    customDateTo: "",
    syncInterval: "Manual",
    autoImport: false
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveAccount() {
    const response = await apiFetch("/api/email-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, accountName: form.accountName || form.emailAddress })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save account.");
    setAccountId(data.account.id);
    return String(data.account.id);
  }

  async function testConnection() {
    setLoading("test");
    setError(null);
    try {
      const id = accountId || await saveAccount();
      const response = await apiFetch(`/api/email-accounts/${id}/test`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Connection test failed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setLoading(null);
    }
  }

  async function discoverFolders() {
    setLoading("folders");
    setError(null);
    try {
      const id = accountId || await saveAccount();
      const response = await apiFetch(`/api/email-accounts/${id}/folders`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to discover folders.");
      setFolders(data.folders || []);
      const paths = (data.flatFolders || []).filter((folder: any) => folder.selectable).map((folder: any) => String(folder.path));
      if (!form.selectedFolders.length) update("selectedFolders", paths);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to discover folders.");
    } finally {
      setLoading(null);
    }
  }

  async function save(startImport: boolean) {
    setLoading(startImport ? "import" : "save");
    setError(null);
    try {
      const id = accountId || await saveAccount();
      await saveAccount();
      if (startImport && form.selectedFolders.length) {
        const jobResponse = await apiFetch("/api/lead-import/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: id, folderPaths: form.selectedFolders, batchSize: 50 })
        });
        const jobData = await jobResponse.json();
        if (!jobResponse.ok) throw new Error(jobData.error || "Unable to start import.");
        await apiFetch(`/api/lead-import/jobs/${jobData.job.id}/run`, { method: "POST" });
      }
      router.push(`/email-accounts/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save account.");
    } finally {
      setLoading(null);
    }
  }

  function nextStep() {
    if (step === 2) {
      discoverFolders().catch(() => null);
    }
    setStep((value) => Math.min(4, value + 1));
  }

  const allFolderPaths = flattenFolders(folders).filter((folder) => folder.selectable).map((folder) => folder.path);

  return (
    <div className="premium-card overflow-hidden">
      <div className="border-b border-line p-5">
        <div className="grid gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className={`rounded-lg border px-3 py-2 text-sm font-bold ${item === step ? "border-accent bg-subtle text-ink" : "border-line text-muted"}`}>
              Step {item}
            </div>
          ))}
        </div>
      </div>

      <div className="p-5">
        {step === 1 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Email Address" value={form.emailAddress} onChange={(value) => update("emailAddress", value)} />
            <Select label="Role" value={form.role} options={roles} onChange={(value) => update("role", value)} />
            <Field label="Account Name" value={form.accountName} onChange={(value) => update("accountName", value)} />
            <Field label="Description" value={form.description} onChange={(value) => update("description", value)} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="IMAP Host" value={form.imapHost} onChange={(value) => update("imapHost", value)} />
              <Field label="IMAP Port" value={form.imapPort} onChange={(value) => update("imapPort", value)} />
              <Field label="SMTP Host" value={form.smtpHost} onChange={(value) => update("smtpHost", value)} />
              <Field label="SMTP Port" value={form.smtpPort} onChange={(value) => update("smtpPort", value)} />
              <Field label="Username" value={form.username} onChange={(value) => update("username", value)} />
              <Field label="Password" type="password" value={form.password} onChange={(value) => update("password", value)} />
            </div>
            <button className="btn-secondary inline-flex items-center gap-2" onClick={testConnection} disabled={Boolean(loading)}>
              {loading === "test" ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
              Test Connection
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Folder Discovery</h2>
                <p className="text-sm text-muted">{form.selectedFolders.length} folders selected</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => update("selectedFolders", allFolderPaths)}>Select All</button>
                <button className="btn-secondary" onClick={discoverFolders} disabled={Boolean(loading)}>
                  {loading === "folders" ? "Refreshing..." : "Refresh Folder List"}
                </button>
              </div>
            </div>
            <div className="max-h-[520px] overflow-auto rounded-lg border border-line bg-subtle p-4">
              {folders.length ? (
                <FolderList folders={folders} selected={form.selectedFolders} onToggle={(path) => {
                  update("selectedFolders", form.selectedFolders.includes(path)
                    ? form.selectedFolders.filter((item) => item !== path)
                    : [...form.selectedFolders, path]);
                }} />
              ) : (
                <div className="flex items-center gap-3 text-sm text-muted">
                  <FolderTree size={18} />
                  Folder list will appear after discovery.
                </div>
              )}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Select label="Import Range" value={form.importRange} options={ranges} onChange={(value) => update("importRange", value)} />
            <Select label="Sync Interval" value={form.syncInterval} options={intervals} onChange={(value) => update("syncInterval", value)} />
            {form.importRange === "Custom Date Range" ? (
              <>
                <Field label="From" type="date" value={form.customDateFrom} onChange={(value) => update("customDateFrom", value)} />
                <Field label="To" type="date" value={form.customDateTo} onChange={(value) => update("customDateTo", value)} />
              </>
            ) : null}
            <label className="flex items-center gap-3 rounded-lg border border-line bg-subtle p-4 text-sm font-semibold">
              <input type="checkbox" checked={form.autoImport} onChange={(event) => update("autoImport", event.target.checked)} />
              Auto Import
            </label>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle size={16} />
            {error}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-5">
        <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step === 1 || Boolean(loading)}>
          <ChevronLeft size={16} />
          Back
        </button>
        {step < 4 ? (
          <button className="btn-primary inline-flex items-center gap-2" onClick={nextStep} disabled={Boolean(loading)}>
            Next
            <ChevronRight size={16} />
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary inline-flex items-center gap-2" onClick={() => save(false)} disabled={Boolean(loading)}>
              {loading === "save" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Account
            </button>
            <button className="btn-primary inline-flex items-center gap-2" onClick={() => save(true)} disabled={Boolean(loading)}>
              {loading === "import" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Save & Start Import
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FolderList({ folders, selected, onToggle }: { folders: FolderNode[]; selected: string[]; onToggle: (path: string) => void }) {
  return (
    <div className="space-y-2">
      {folders.map((folder) => (
        <div key={folder.path} className="pl-1">
          <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface">
            <input type="checkbox" disabled={!folder.selectable} checked={selected.includes(folder.path)} onChange={() => onToggle(folder.path)} />
            <span className={folder.selectable ? "font-medium" : "text-muted"}>{folder.name}</span>
            <span className="text-xs text-muted">{folder.path}</span>
          </label>
          {folder.children?.length ? <div className="ml-5 border-l border-line pl-3"><FolderList folders={folder.children} selected={selected} onToggle={onToggle} /></div> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-muted">{label}</span>
      <input type={type} className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 outline-none focus:border-accent" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-muted">{label}</span>
      <select className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 outline-none focus:border-accent" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function flattenFolders(folders: FolderNode[]): FolderNode[] {
  return folders.flatMap((folder) => [folder, ...flattenFolders(folder.children || [])]);
}
