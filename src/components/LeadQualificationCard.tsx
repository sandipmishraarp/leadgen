"use client";

import type { LeadQualification, Prisma } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, RefreshCw, Target, TrendingUp } from "lucide-react";
import { ClientDateTime } from "@/components/ClientDateTime";

type Props = {
  leadId: string;
  qualification: LeadQualification | null;
};

type Reasoning = {
  positives?: string[];
  negatives?: string[];
  signals?: Record<string, unknown>;
  caveats?: string[];
};

export function LeadQualificationCard({ leadId, qualification }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasoning = parseReasoning(qualification?.reasoning);

  async function recalculate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/qualification`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to recalculate qualification.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to recalculate qualification.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="premium-card p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-subtle px-3 py-1 text-xs font-semibold text-muted">
            <Target size={14} className="text-accent" />
            Lead Qualification
          </div>
          <h2 className="text-lg font-bold">Score and priority</h2>
        </div>
        <button className="btn-secondary inline-flex items-center gap-2" onClick={recalculate} disabled={loading}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Recalculate Score
        </button>
      </div>

      {qualification ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Score" value={`${qualification.score}/100`} />
            <Metric label="Class" value={qualification.classification.replaceAll("_", " ")} />
            <Metric label="Win Probability" value={`${qualification.winProbability}%`} />
            <Metric label="Deal Estimate" value={qualification.dealSizeEstimate ? `$${qualification.dealSizeEstimate.toLocaleString()}` : "Not enough data"} />
          </div>

          <div className="mt-4 rounded-lg border border-line bg-subtle p-4">
            <div className="flex items-start gap-3">
              <TrendingUp size={18} className="mt-0.5 text-accent" />
              <div>
                <div className="text-sm font-bold">Recommended action</div>
                <p className="mt-1 text-sm text-muted">{qualification.recommendedAction || "Review this lead and choose the next human-approved action."}</p>
                <div className="mt-2 text-xs font-medium text-muted">Confidence {qualification.confidence || 0}% · Scored <ClientDateTime value={qualification.scoredAt} timeStyle="short" /></div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <ReasonList title="Positive signals" items={reasoning.positives || []} empty="No strong positive signals yet." />
            <ReasonList title="Risks / caveats" items={[...(reasoning.negatives || []), ...(reasoning.caveats || [])]} empty="No major risks recorded." />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-subtle p-5 text-sm text-muted">
          No qualification score yet. Recalculate to create the first score from existing lead and engagement data.
        </div>
      )}

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-lg font-bold">{value}</div>
    </div>
  );
}

function ReasonList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="mb-2 text-sm font-bold">{title}</div>
      <div className="space-y-2 text-sm text-muted">
        {items.length ? items.slice(0, 5).map((item) => <div key={item}>- {item}</div>) : <div>{empty}</div>}
      </div>
    </div>
  );
}

function parseReasoning(value: Prisma.JsonValue | undefined): Reasoning {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Reasoning;
}
