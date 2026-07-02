"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function GenerateFirstReplyButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    const response = await apiFetch(`/api/leads/${leadId}/first-reply-draft`, { method: "POST" });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error || "Unable to generate first reply");
      return;
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
      <Button type="button" onClick={generate} disabled={loading}>
        {loading ? "Generating..." : "Generate First Reply from Abhay"}
      </Button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
