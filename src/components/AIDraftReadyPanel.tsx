"use client";

import { useEffect, useState } from "react";

const quickActions = ["Professional", "Friendly", "Shorten", "Expand", "Rewrite", "Generate Follow-up", "Translate"];

export function AIDraftReadyPanel({ hasClientBrain, hasQualification }: { hasClientBrain: boolean; hasQualification: boolean }) {
  const [confidence, setConfidence] = useState<number | null>(null);

  useEffect(() => {
    const raw = window.sessionStorage.getItem("aiDraftReady");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { confidence?: number; at?: number };
      if (parsed.at && Date.now() - parsed.at < 120_000) setConfidence(parsed.confidence || 80);
    } catch {
      setConfidence(80);
    }
    window.sessionStorage.removeItem("aiDraftReady");
  }, []);

  function runAction(action: string) {
    window.dispatchEvent(new CustomEvent("composer-ai-action", { detail: { action } }));
  }

  function openPreview() {
    window.dispatchEvent(new CustomEvent("composer-preview", { detail: { mode: "desktop" } }));
  }

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      {confidence !== null ? (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-emerald-900">AI Draft Ready</h2>
              <p className="mt-1 text-sm text-emerald-800">Confidence {confidence}%</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700">Ready to edit</span>
          </div>
          <div className="mt-3 text-sm text-emerald-900">
            Generated using: Client Brain, Conversation, Lead Intelligence, Qualification
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-lg border border-line bg-subtle p-3">
          <h3 className="font-bold">Why AI generated this email</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            <li>- It used the latest conversation and lead details.</li>
            <li>- It used lead intelligence to shape timing and approach.</li>
            <li>- {hasClientBrain ? "It used saved Client Brain memory." : "Client Brain is not available yet."}</li>
            <li>- {hasQualification ? "It used qualification score and recommended action." : "Qualification score is not available yet."}</li>
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-subtle p-3">
          <h3 className="font-bold">Quick actions</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <button key={action} type="button" onClick={() => runAction(action)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-strong">
                {action === "Shorten" ? "Shorter" : action === "Expand" ? "Longer" : action}
              </button>
            ))}
            <button type="button" onClick={openPreview} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-strong">
              Preview
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
