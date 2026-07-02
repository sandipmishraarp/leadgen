"use client";

import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function LeadIntakeActions({
  intakeId,
  clientEmail,
  lowConfidence,
  isForwardedWarmReply = false,
  sandipReviewPending = false
}: {
  intakeId: string;
  clientEmail: string;
  lowConfidence: boolean;
  isForwardedWarmReply?: boolean;
  sandipReviewPending?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(normalizeClientEmail(clientEmail));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [assignedEmailAccount, setAssignedEmailAccount] = useState("abhay@aresourcepool.com");
  const [actionType, setActionType] = useState<"FIRST_REPLY" | "FOLLOW_UP" | "REVIVAL">("FIRST_REPLY");

  async function act(action: "APPROVE" | "REJECT" | "HOLD" | "ARCHIVE" | "CONFIRM_EMAIL" | "CONTINUE_ABHAY" | "GENERATE_ABHAY_DRAFT" | "ACCEPT_CONTINUE" | "REJECT_PERMANENTLY") {
    setBusy(action);
    setMessage("");
    const salesAction = action === "APPROVE" || action === "CONTINUE_ABHAY" || action === "GENERATE_ABHAY_DRAFT" || action === "ACCEPT_CONTINUE";
    const response = await apiFetch(`/api/lead-intake/${intakeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        clientEmail: normalizeClientEmail(email) || undefined,
        assignedUser: salesAction ? ownerFromEmail(assignedEmailAccount) : undefined,
        assignedEmailAccount: salesAction ? assignedEmailAccount : undefined,
        actionType: salesAction ? actionType : undefined
      })
    });
    const data = await response.json();
    setBusy(null);
    if (!response.ok) {
      setMessage(data.error || "Unable to update lead");
      return;
    }
    if ((action === "GENERATE_ABHAY_DRAFT" || action === "CONTINUE_ABHAY" || action === "ACCEPT_CONTINUE") && data.item?.leadId) {
      if (data.draft?.id) {
        window.sessionStorage.setItem("leadDetailActiveTab", "drafts");
        window.sessionStorage.setItem("freshDraftGeneratedId", data.draft.id);
        window.sessionStorage.setItem("aiDraftReady", JSON.stringify({
          confidence: Math.round((data.draft?.confidence || 0.8) * 100),
          at: Date.now()
        }));
        router.push(`/leads/${data.item.leadId}#drafts-composer`);
        return;
      }
      router.push(`/leads/${data.item.leadId}`);
      return;
    }
    setMessage(action === "GENERATE_ABHAY_DRAFT" ? "Context reply draft created for Abhay. Open the lead to review before sending." : "Updated");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Client email</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm"
          placeholder="client@example.com"
        />
      </label>
      {lowConfidence ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Confirm client email before approving.
        </div>
      ) : null}
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Assign to sales account</span>
        <select value={assignedEmailAccount} onChange={(event) => setAssignedEmailAccount(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm">
          <option value="abhay@aresourcepool.com">Abhay</option>
          <option value="parmeet@aresourcepool.com">Parmeet</option>
          <option value="karan@aresourcepool.com">Karan</option>
          <option value="bhanu@aresourcepool.com">Bhanu</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Action type</span>
        <select value={actionType} onChange={(event) => setActionType(event.target.value as any)} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm">
          <option value="FIRST_REPLY">First Reply</option>
          <option value="FOLLOW_UP">Follow-up</option>
          <option value="REVIVAL">Revival</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {sandipReviewPending ? (
          <>
            <Button type="button" onClick={() => act("ACCEPT_CONTINUE")} disabled={busy !== null}>
              {busy === "ACCEPT_CONTINUE" ? "Accepting..." : "Accept & Continue"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => act("REJECT_PERMANENTLY")} disabled={busy !== null}>
              {busy === "REJECT_PERMANENTLY" ? "Rejecting..." : "Reject Permanently"}
            </Button>
          </>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => act("CONFIRM_EMAIL")} disabled={busy !== null}>
          {busy === "CONFIRM_EMAIL" ? "Confirming..." : "Confirm Client Email"}
        </Button>
        {!sandipReviewPending ? (
          <>
            <Button type="button" onClick={() => act("GENERATE_ABHAY_DRAFT")} disabled={busy !== null}>
              {busy === "GENERATE_ABHAY_DRAFT" ? "Generating..." : isForwardedWarmReply ? "Generate Context Reply as Abhay" : "Generate Draft as Abhay"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => act("CONTINUE_ABHAY")} disabled={busy !== null}>
              {busy === "CONTINUE_ABHAY" ? "Continuing..." : "Continue Anyway"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => act("APPROVE")} disabled={busy !== null}>
              {busy === "APPROVE" ? "Assigning..." : "Assign to Sales"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => act("APPROVE")} disabled={busy !== null}>
              {busy === "APPROVE" ? "Approving..." : "Mark Approved"}
            </Button>
          </>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => act("HOLD")} disabled={busy !== null}>
          Hold
        </Button>
        {!sandipReviewPending ? (
          <Button type="button" variant="secondary" onClick={() => act("REJECT")} disabled={busy !== null}>
            Mark Not Approved
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => act("ARCHIVE")} disabled={busy !== null}>
          Archive
        </Button>
      </div>
      {message ? <div className="text-sm text-slate-600">{message}</div> : null}
    </div>
  );
}

function normalizeClientEmail(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/\[mailto\]/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, " ")
    .trim();
  return cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || cleaned;
}

function ownerFromEmail(email: string) {
  const name = email.split("@")[0] || "Sales";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function BulkLeadIntakeActions() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function bulk(action: "APPROVE" | "REJECT" | "HOLD" | "ARCHIVE") {
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="selectedLeadIntake"]:checked')).map((input) => input.value);
    if (!ids.length) {
      setMessage("Select at least one lead.");
      return;
    }
    setBusy(action);
    setMessage("");
    const response = await apiFetch("/api/lead-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids })
    });
    const data = await response.json();
    setBusy(null);
    if (!response.ok) {
      setMessage(data.error || "Bulk update failed");
      return;
    }
    setMessage(`Updated ${data.updated || ids.length} lead(s)`);
    router.refresh();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3">
      <span className="text-sm font-semibold text-slate-600">Bulk actions</span>
      <Button type="button" onClick={() => bulk("APPROVE")} disabled={busy !== null}>{busy === "APPROVE" ? "Approving..." : "Approve selected"}</Button>
      <Button type="button" variant="secondary" onClick={() => bulk("HOLD")} disabled={busy !== null}>Hold selected</Button>
      <Button type="button" variant="secondary" onClick={() => bulk("REJECT")} disabled={busy !== null}>Reject selected</Button>
      <Button type="button" variant="secondary" onClick={() => bulk("ARCHIVE")} disabled={busy !== null}>Archive selected</Button>
      {message ? <span className="text-sm text-slate-600">{message}</span> : null}
    </div>
  );
}
