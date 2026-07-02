"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { ClientDateTime } from "@/components/ClientDateTime";

type TrackingState = {
  enabled: boolean;
  gatewayBaseUrl: string | null;
  lastSyncAt: Date | string | null;
  lastHealthAt: Date | string | null;
  lastHealthStatus: string | null;
  lastTrackingEventId: string | null;
  eventsPulled: number;
  eventsImported: number;
  eventsSkipped: number;
  unmatchedEvents?: number;
  localDbStatus?: string | null;
  gatewayLatencyMs: number | null;
  syncDurationMs: number | null;
  lastError: string | null;
};

export function TrackingSettingsPanel({ state, apiKeyConfigured }: { state: TrackingState | null; apiKeyConfigured: boolean }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function action(kind: "sync" | "health") {
    setBusy(kind);
    setMessage("");
    const response = await fetch(`/api/tracking/${kind}`, { method: "POST" });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setMessage(data.error || "Tracking action failed");
      return;
    }
    setMessage(kind === "sync"
      ? `Sync complete: ${data.result?.pulled || 0} pulled, ${data.result?.imported || 0} imported, ${data.result?.unmatched || 0} unmatched, ${data.result?.skipped || 0} skipped.`
      : `Gateway status: ${data.health?.lastHealthStatus || "checked"}.`
    );
  }

  return (
    <section className="premium-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Tracking Gateway</h2>
          <p className="mt-1 text-sm text-muted">Public PHP gateway sync for opens and clicks.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${state?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
          {state?.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {!apiKeyConfigured ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          TRACKING_GATEWAY_API_KEY is missing. Gateway sync will be skipped until it is added to .env.
        </div>
      ) : null}
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <Info label="Gateway URL" value={state?.gatewayBaseUrl || "Not set"} />
        <Info label="Gateway Status" value={state?.lastHealthStatus || "Not checked"} />
        <Info label="Local DB" value={state?.localDbStatus || "Unknown"} />
        <Info label="Last Sync" value={<ClientDateTime value={state?.lastSyncAt} fallback="Never" timeStyle="short" />} />
        <Info label="Last Event ID" value={state?.lastTrackingEventId || "None"} />
        <Info label="Events Pulled" value={String(state?.eventsPulled || 0)} />
        <Info label="Events Imported" value={String(state?.eventsImported || 0)} />
        <Info label="Events Skipped" value={String(state?.eventsSkipped || 0)} />
        <Info label="Unmatched Events" value={String(state?.unmatchedEvents || 0)} />
        <Info label="Gateway Latency" value={state?.gatewayLatencyMs ? `${state.gatewayLatencyMs} ms` : "--"} />
      </div>
      {state?.lastError ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{state.lastError}</div> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => action("health")} disabled={Boolean(busy)}>
          {busy === "health" ? "Checking..." : "Health Check"}
        </Button>
        <Button type="button" onClick={() => action("sync")} disabled={Boolean(busy)}>
          {busy === "sync" ? "Syncing..." : "Manual Sync"}
        </Button>
        {message ? <span className="text-sm text-muted">{message}</span> : null}
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-words font-semibold">{value}</div>
    </div>
  );
}
