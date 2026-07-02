"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";

const statuses = [
  "WAITING_FOR_SANDIP",
  "APPROVED",
  "REJECTED",
  "HOLD",
  "ARCHIVED",
  "NEEDS_REPLY",
  "CLIENT_REPLIED",
  "CONTACTED",
  "NEW",
  "DRAFT_CREATED",
  "REPLIED",
  "FOLLOW_UP_NEEDED",
  "PROPOSAL_SENT",
  "WON",
  "LOST"
];

export function LeadStatusSelect({ leadId, status }: { leadId: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);

  async function update(next: string) {
    setValue(next);
    await apiFetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next })
    });
    router.refresh();
  }

  return (
    <select
      value={value}
      onChange={(event) => update(event.target.value)}
      className="h-9 rounded-md border border-line bg-white px-2 text-sm"
    >
      {statuses.map((item) => (
        <option key={item} value={item}>
          {item.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
