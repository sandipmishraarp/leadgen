"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, DownloadCloud, Loader2, PauseCircle, PlugZap, RefreshCw, RotateCcw } from "lucide-react";

export function EmailAccountActions({ accountId, canImport = false }: { accountId: string; canImport?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "sync" | "test" | "disable" | "import" | "pause-auto" | "rebuild-index") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(
        action === "disable"
          ? `/api/email-accounts/${accountId}`
          : action === "pause-auto"
            ? `/api/email-accounts/${accountId}`
          : action === "rebuild-index"
            ? `/api/email-accounts/${accountId}/rebuild-folder-index`
          : action === "test"
            ? `/api/email-accounts/${accountId}/test`
            : `/api/email-accounts/${accountId}/sync`,
        {
          method: action === "disable" || action === "pause-auto" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body:
            action === "disable"
              ? JSON.stringify({ isActive: false, status: "DISABLED" })
              : action === "pause-auto"
                ? JSON.stringify({ autoSyncEnabled: false, schedulerConfig: { autoSyncEnabled: false, syncInterval: "MANUAL" } })
                : undefined
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Unable to ${action} account.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} account.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary inline-flex items-center gap-2" onClick={() => run("sync")} disabled={Boolean(busy)}>
          {busy === "sync" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Sync
        </button>
        {canImport ? (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => run("import")} disabled={Boolean(busy)}>
            {busy === "import" ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />}
            Import All New
          </button>
        ) : null}
        <button className="btn-secondary inline-flex items-center gap-2" onClick={() => run("pause-auto")} disabled={Boolean(busy)}>
          {busy === "pause-auto" ? <Loader2 size={15} className="animate-spin" /> : <PauseCircle size={15} />}
          Pause Auto Sync
        </button>
        <button className="btn-secondary inline-flex items-center gap-2" onClick={() => run("rebuild-index")} disabled={Boolean(busy)}>
          {busy === "rebuild-index" ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
          Rebuild Folder Index
        </button>
        <button className="btn-secondary inline-flex items-center gap-2" onClick={() => run("test")} disabled={Boolean(busy)}>
          {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
          Test
        </button>
        <button className="btn-secondary" onClick={() => run("disable")} disabled={Boolean(busy)}>Disable</button>
      </div>
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={14} />
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function SyncAllEmailAccountsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function syncAll() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/email-accounts/sync-all", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to sync accounts.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sync accounts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-secondary inline-flex items-center gap-2" onClick={syncAll} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        Sync All
      </button>
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  );
}
