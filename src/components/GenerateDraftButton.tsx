"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function GenerateDraftButton({
  threadId,
  draftType = "REPLY",
  label,
  confirmRegenerate = false
}: {
  threadId: string;
  draftType?: "REPLY" | "FOLLOWUP";
  label?: string;
  confirmRegenerate?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function generate() {
    if (confirmRegenerate && !window.confirm("A draft already exists for this thread. Regenerate anyway?")) {
      window.sessionStorage.setItem("leadDetailActiveTab", "drafts");
      window.location.hash = "drafts-composer";
      window.dispatchEvent(new Event("lead-detail-open-tab"));
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, draftType })
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error || "Unable to generate draft");
      return;
    }
    if (data.existingConversation) {
      setNotice("✓ Existing conversation detected. Replying to current thread.");
    }
    if (data.draft?.id) {
      window.sessionStorage.setItem("leadDetailActiveTab", "drafts");
      window.sessionStorage.setItem("freshDraftGeneratedId", data.draft.id);
      window.sessionStorage.setItem("aiDraftReady", JSON.stringify({
        confidence: Math.round((data.draft?.confidence || 0.8) * 100),
        at: Date.now()
      }));
      window.location.hash = "drafts-composer";
    }
    router.refresh();
    window.setTimeout(() => window.dispatchEvent(new Event("lead-detail-open-tab")), 250);
  }

  return (
    <div>
      <Button onClick={generate} disabled={loading}>{loading ? "Generating..." : label || "Generate AI Draft"}</Button>
      {notice ? <p className="mt-2 text-sm font-semibold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
