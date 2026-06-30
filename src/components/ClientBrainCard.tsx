"use client";

import type { ClientBrain, Prisma } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Brain, Edit3, RefreshCw, Send, Save, X } from "lucide-react";

type Props = {
  leadId: string;
  clientBrain: ClientBrain | null;
};

type BrainForm = {
  summary: string;
  interestedService: string;
  budgetRange: string;
  painPoints: string;
  objections: string;
  preferredTone: string;
  preferredEmailTime: string;
  decisionStage: string;
  currentTemperature: string;
  recommendedNextStep: string;
  nextBestAction: string;
};

export function ClientBrainCard({ leadId, clientBrain }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"refresh" | "save" | "draft" | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BrainForm>(() => toForm(clientBrain));

  async function refreshBrain() {
    setLoading("refresh");
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/client-brain`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to refresh client brain.");
      setForm(toForm(data.clientBrain));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh client brain.");
    } finally {
      setLoading(null);
    }
  }

  async function saveBrain() {
    setLoading("save");
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/client-brain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: form.summary,
          interestedService: form.interestedService,
          budgetRange: form.budgetRange,
          painPoints: lines(form.painPoints),
          objections: lines(form.objections),
          preferredTone: form.preferredTone,
          preferredEmailTime: form.preferredEmailTime,
          decisionStage: form.decisionStage,
          currentTemperature: form.currentTemperature,
          recommendedNextStep: form.recommendedNextStep,
          nextBestAction: form.nextBestAction
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save client brain.");
      setForm(toForm(data.clientBrain));
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save client brain.");
    } finally {
      setLoading(null);
    }
  }

  async function generateEmailUsingBrain() {
    setLoading("draft");
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/first-reply-draft`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to generate draft.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate draft.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="premium-card p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-subtle px-3 py-1 text-xs font-semibold text-muted">
            <Brain size={14} className="text-accent" />
            AI Client Brain
          </div>
          <h2 className="text-lg font-bold">Memory and next step</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary inline-flex items-center gap-2" onClick={refreshBrain} disabled={Boolean(loading)}>
            <RefreshCw size={16} className={loading === "refresh" ? "animate-spin" : ""} />
            Refresh Client Brain
          </button>
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setEditing((value) => !value)} disabled={Boolean(loading)}>
            {editing ? <X size={16} /> : <Edit3 size={16} />}
            {editing ? "Cancel" : "Edit Client Brain"}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field label="Summary" value={form.summary} onChange={(value) => setForm({ ...form, summary: value })} multiline />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Interested Service" value={form.interestedService} onChange={(value) => setForm({ ...form, interestedService: value })} />
            <Field label="Budget" value={form.budgetRange} onChange={(value) => setForm({ ...form, budgetRange: value })} />
            <Field label="Preferred Tone" value={form.preferredTone} onChange={(value) => setForm({ ...form, preferredTone: value })} />
            <Field label="Preferred Email Time" value={form.preferredEmailTime} onChange={(value) => setForm({ ...form, preferredEmailTime: value })} />
            <Field label="Decision Stage" value={form.decisionStage} onChange={(value) => setForm({ ...form, decisionStage: value })} />
            <Field label="Current Temperature" value={form.currentTemperature} onChange={(value) => setForm({ ...form, currentTemperature: value })} />
          </div>
          <Field label="Pain Points, one per line" value={form.painPoints} onChange={(value) => setForm({ ...form, painPoints: value })} multiline />
          <Field label="Objections, one per line" value={form.objections} onChange={(value) => setForm({ ...form, objections: value })} multiline />
          <Field label="Recommended Next Step" value={form.recommendedNextStep} onChange={(value) => setForm({ ...form, recommendedNextStep: value })} multiline />
          <Field label="Next Best Action" value={form.nextBestAction} onChange={(value) => setForm({ ...form, nextBestAction: value })} multiline />
          <button className="btn-primary inline-flex items-center gap-2" onClick={saveBrain} disabled={Boolean(loading)}>
            <Save size={16} />
            Save Client Brain
          </button>
        </div>
      ) : clientBrain ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-line bg-subtle p-4 text-sm leading-6 text-muted">{clientBrain.summary || "No summary captured yet."}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Info label="Interested service" value={clientBrain.interestedService || "Not set"} />
            <Info label="Budget" value={clientBrain.budgetRange || "Not set"} />
            <Info label="Preferred tone" value={clientBrain.preferredTone || "Not set"} />
            <Info label="Preferred email time" value={clientBrain.preferredEmailTime || "Not set"} />
            <Info label="Decision stage" value={clientBrain.decisionStage || "Not set"} />
            <Info label="Current temperature" value={clientBrain.currentTemperature || "Not set"} />
          </div>
          <ListBlock label="Pain points" value={clientBrain.painPoints} />
          <ListBlock label="Objections" value={clientBrain.objections} />
          <Info label="Recommended next step" value={clientBrain.recommendedNextStep || "Not set"} />
          <Info label="Next best action" value={clientBrain.nextBestAction || "Not set"} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-subtle p-5 text-sm text-muted">
          No client brain yet. Refresh to generate structured memory from the existing lead history.
        </div>
      )}

      <div className="mt-5">
        <button className="btn-primary inline-flex items-center gap-2" onClick={generateEmailUsingBrain} disabled={Boolean(loading)}>
          <Send size={16} />
          Generate Email Using Client Brain
        </button>
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-muted">{label}</span>
      {multiline ? (
        <textarea className="mt-1 min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-accent" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-accent" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ListBlock({ label, value }: { label: string; value: Prisma.JsonValue }) {
  const items = arrayValue(value);
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 space-y-1 text-sm text-muted">
        {items.length ? items.map((item) => <div key={item}>- {item}</div>) : <div>Not set</div>}
      </div>
    </div>
  );
}

function toForm(clientBrain: ClientBrain | null): BrainForm {
  return {
    summary: clientBrain?.summary || "",
    interestedService: clientBrain?.interestedService || "",
    budgetRange: clientBrain?.budgetRange || "",
    painPoints: arrayValue(clientBrain?.painPoints).join("\n"),
    objections: arrayValue(clientBrain?.objections).join("\n"),
    preferredTone: clientBrain?.preferredTone || "",
    preferredEmailTime: clientBrain?.preferredEmailTime || "",
    decisionStage: clientBrain?.decisionStage || "",
    currentTemperature: clientBrain?.currentTemperature || "",
    recommendedNextStep: clientBrain?.recommendedNextStep || "",
    nextBestAction: clientBrain?.nextBestAction || ""
  };
}

function arrayValue(value: Prisma.JsonValue | undefined) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function lines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}
