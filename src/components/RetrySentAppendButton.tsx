"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function RetrySentAppendButton({ sentEmailId }: { sentEmailId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function retry() {
    setBusy(true);
    setMessage("");
    const response = await apiFetch(`/api/sent-emails/${sentEmailId}/retry-append`, { method: "POST" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Unable to copy to Sent folder");
      return;
    }
    setMessage("Copied to Sent folder");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" onClick={retry} disabled={busy}>
        {busy ? "Retrying..." : "Retry Append"}
      </Button>
      {message ? <span className="text-sm text-muted">{message}</span> : null}
    </div>
  );
}
