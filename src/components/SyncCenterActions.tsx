"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export function SyncCenterRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/sync-center/run", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to run sync.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run sync.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-primary inline-flex items-center gap-2" onClick={run} disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        Sync All Now
      </button>
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  );
}
