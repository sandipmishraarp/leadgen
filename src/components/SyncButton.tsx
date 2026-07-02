"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function SyncButton({ accountEmail, accountId, mode = "all" }: { accountEmail?: string; accountId?: string | null; mode?: "all" | "lead-intake-latest" }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);

  async function sync(nextMode: "all" | "lead-intake-latest" | "force-lead-intake-latest" = mode) {
    setLoading(true);
    setMessage(nextMode === "force-lead-intake-latest" ? "Force checking latest 100" : "Connecting");
    setSteps(["Connecting"]);
    const response = await apiFetch("/api/mail/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: nextMode === "force-lead-intake-latest" ? 100 : limit, mode: nextMode, accountEmail, accountId })
    });
    const data = await response.json();
    if (!response.ok) {
      setLoading(false);
      setMessage(data.error || "Sync failed");
      return;
    }
    setMessage(data.message || "Sync running in background");
    setSteps((current) => [...current, "Checking latest emails"]);
    await pollSyncStatus(nextMode);
  }

  async function pollSyncStatus(activeMode: "all" | "lead-intake-latest" | "force-lead-intake-latest") {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (accountEmail) params.set("accountEmail", accountEmail);
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await apiFetch(`/api/mail/sync?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      if (data.status === "RUNNING") {
        setMessage("Syncing in background...");
        setSteps((current) => [...current.slice(-4), "Still syncing"]);
        continue;
      }
      setLoading(false);
      if (data.status === "FAILED") {
        setMessage(data.error || "Sync failed");
        return;
      }
      const result = data.result || {};
      const payload = activeMode === "lead-intake-latest" || activeMode === "force-lead-intake-latest" ? result : result.accounts ? result : {};
    if (activeMode === "lead-intake-latest" || activeMode === "force-lead-intake-latest") {
      const nextSteps = Array.isArray(payload.steps) ? payload.steps : [
        "Connecting",
        "Checking latest emails",
        `Imported ${payload.imported || 0} new emails`,
        `Created ${payload.imported || 0} leads`,
        `Updated ${payload.updated || 0} leads`,
        `Skipped ${payload.skipped || 0} duplicates`
      ];
      setSteps(nextSteps);
      setMessage(`${payload.forceLatest ? "Force sync complete" : "Sync complete"}: imported ${payload.imported || 0} new emails · skipped ${payload.skipped || 0} duplicates`);
    } else {
      setMessage("Sync completed");
    }
    router.refresh();
      return;
    }
    setLoading(false);
    setMessage("Sync is still running. You can continue using the app.");
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={limit}
        onChange={(event) => setLimit(Number(event.target.value))}
        className="h-10 rounded-md border border-line bg-white px-3 text-sm"
      >
        {[50, 100, 250, 500].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <Button onClick={() => sync(mode)} disabled={loading}>{loading ? "Syncing..." : "Sync Emails"}</Button>
      {mode === "lead-intake-latest" ? (
        <Button type="button" variant="secondary" onClick={() => sync("force-lead-intake-latest")} disabled={loading}>
          Force latest 100
        </Button>
      ) : null}
      {message ? <span className="text-sm text-slate-600">{message}</span> : null}
      {steps.length ? (
        <span className="hidden text-xs text-slate-500 lg:inline">
          {steps.slice(-3).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}
