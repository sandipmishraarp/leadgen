"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function FollowupSafeBulkActions({
  mailbox,
  safeCount
}: {
  mailbox: string;
  safeCount: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function generateSafeDrafts() {
    setLoading(true);
    setMessage("Preparing safe draft queue...");
    const response = await fetch("/api/followups/generate-safe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailbox, limit: 10 })
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to generate safe follow-up drafts.");
      return;
    }
    setMessage(`${data.generated}/${data.totalConsidered} drafts generated · ${data.skipped} skipped · ${data.failed} failed`);
    router.refresh();
  }

  return (
    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-emerald-900">Safe follow-up automation</div>
          <p className="mt-1 text-sm text-emerald-800">
            {safeCount} safe follow-up{safeCount === 1 ? "" : "s"} ready. Generates max 10 drafts per batch. No email is sent.
          </p>
        </div>
        <Button type="button" onClick={generateSafeDrafts} disabled={loading || safeCount === 0}>
          {loading ? "Generating..." : "Generate Drafts for All Safe"}
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm font-semibold text-emerald-900">{message}</p> : null}
    </div>
  );
}
