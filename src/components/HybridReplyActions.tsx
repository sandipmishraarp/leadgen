"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { GenerateDraftButton } from "@/components/GenerateDraftButton";

export function HybridReplyActions({
  threadId,
  hasDraft = false,
  blocked = false,
  compact = false
}: {
  threadId: string;
  hasDraft?: boolean;
  blocked?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  async function createManualDraft(nextAction?: "schedule" | "send" | "template") {
    if (blocked) return;
    setLoading(nextAction || "manual");
    setError("");
    const response = await apiFetch("/api/drafts/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId })
    });
    const data = await response.json();
    setLoading("");
    if (!response.ok) {
      setError(data.error || "Unable to create manual reply draft.");
      return;
    }
    window.sessionStorage.setItem("leadDetailActiveTab", "drafts");
    window.sessionStorage.setItem("freshDraftGeneratedId", data.draft.id);
    if (nextAction) window.sessionStorage.setItem("pendingDraftEditorAction", nextAction);
    window.location.hash = "drafts-composer";
    router.refresh();
    window.setTimeout(() => window.dispatchEvent(new Event("lead-detail-open-tab")), 250);
  }

  function openComposer(action?: "schedule" | "send" | "template") {
    window.sessionStorage.setItem("leadDetailActiveTab", "drafts");
    if (action) window.sessionStorage.setItem("pendingDraftEditorAction", action);
    window.location.hash = "drafts-composer";
    window.dispatchEvent(new Event("lead-detail-open-tab"));
    window.setTimeout(() => {
      if (action) window.dispatchEvent(new CustomEvent("draft-editor-action", { detail: { action } }));
    }, 250);
  }

  function handleAction(action?: "schedule" | "send" | "template") {
    if (hasDraft) openComposer(action);
    else createManualDraft(action);
  }

  if (blocked) {
    return <span className="inline-flex h-10 items-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700">Blocked</span>;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "flex-col" : ""}`}>
      <Button type="button" variant="secondary" onClick={() => createManualDraft()} disabled={Boolean(loading)}>
        {loading === "manual" ? "Opening..." : "Reply Manually"}
      </Button>
      <GenerateDraftButton threadId={threadId} label="Generate AI Draft" confirmRegenerate={hasDraft} />
      <Button type="button" variant="secondary" onClick={() => handleAction("template")} disabled={Boolean(loading)}>
        Use Template
      </Button>
      <Button type="button" variant="secondary" onClick={() => handleAction("schedule")} disabled={Boolean(loading)}>
        Schedule
      </Button>
      <Button type="button" onClick={() => handleAction("send")} disabled={Boolean(loading)}>
        Send
      </Button>
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
