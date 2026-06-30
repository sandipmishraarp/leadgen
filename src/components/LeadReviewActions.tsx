"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

const actions = [
  { label: "Approve", status: "APPROVED" },
  { label: "Reject", status: "REJECTED" },
  { label: "Hold", status: "HOLD" },
  { label: "Archive", status: "ARCHIVED" }
];

const defaultAssignees = [
  { label: "Abhay", email: "abhay@aresourcepool.com" },
  { label: "Parmeet", email: "parmeet@aresourcepool.com" },
  { label: "Karan", email: "karan@aresourcepool.com" },
  { label: "Bhanu", email: "bhanu@aresourcepool.com" }
];

type AccountOption = {
  id: string;
  emailAddress: string;
  role: string;
  label?: string;
  accountType?: string;
};

export function LeadReviewActions({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [assignedUser, setAssignedUser] = useState("Abhay");
  const [customUser, setCustomUser] = useState("");
  const [assignedEmailAccount, setAssignedEmailAccount] = useState("abhay@aresourcepool.com");

  useEffect(() => {
    fetch("/api/mailbox-context")
      .then((response) => response.ok ? response.json() : { accounts: [] })
      .then((data) => {
        const salesAccounts = (data.accounts || []).filter((account: AccountOption) =>
          account.role !== "Lead Intake" && account.accountType !== "LEAD_INTAKE"
        );
        setAccounts(salesAccounts);
        const abhay = salesAccounts.find((account: AccountOption) => account.emailAddress === "abhay@aresourcepool.com") || salesAccounts[0];
        if (abhay) setAssignedEmailAccount(abhay.emailAddress);
      })
      .catch(() => setAccounts([]));
  }, []);

  const accountOptions = useMemo(() => {
    const map = new Map<string, AccountOption>();
    for (const account of accounts) map.set(account.emailAddress, account);
    for (const assignee of defaultAssignees) {
      if (!map.has(assignee.email)) {
        map.set(assignee.email, {
          id: assignee.email,
          emailAddress: assignee.email,
          role: "Sales",
          label: assignee.label,
          accountType: "SALES_SENDER"
        });
      }
    }
    return Array.from(map.values());
  }, [accounts]);

  async function update(status: string, assignment?: { assignedUser: string; assignedEmailAccount: string }) {
    setBusy(status);
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        assignedUser: assignment?.assignedUser,
        assignedEmailAccount: assignment?.assignedEmailAccount,
        currentMailbox: assignment?.assignedEmailAccount
      })
    });
    setBusy("");
    setAssignOpen(false);
    router.refresh();
  }

  function approveWithAssignment() {
    const owner = assignedUser === "Custom" ? customUser.trim() : assignedUser;
    if (!owner || !assignedEmailAccount) return;
    update("APPROVED", { assignedUser: owner, assignedEmailAccount });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.status}
            type="button"
            variant={action.status === "APPROVED" ? "primary" : "secondary"}
            onClick={() => action.status === "APPROVED" ? setAssignOpen(true) : update(action.status)}
            disabled={Boolean(busy)}
          >
            {busy === action.status ? "Updating..." : action.label}
          </Button>
        ))}
      </div>

      {assignOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/40 p-4 backdrop-blur-sm" onMouseDown={() => setAssignOpen(false)}>
          <div className="mx-auto mt-24 max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-5">
              <h2 className="text-lg font-bold">Approve and Assign Lead</h2>
              <p className="mt-1 text-sm text-muted">Choose the sales owner and mailbox where this lead should appear.</p>
            </div>
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="font-semibold text-muted">Assign To</span>
                <select className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={assignedUser} onChange={(event) => setAssignedUser(event.target.value)}>
                  {defaultAssignees.map((assignee) => <option key={assignee.label}>{assignee.label}</option>)}
                  <option>Custom</option>
                </select>
              </label>
              {assignedUser === "Custom" ? (
                <label className="block text-sm">
                  <span className="font-semibold text-muted">Custom Owner</span>
                  <input className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={customUser} onChange={(event) => setCustomUser(event.target.value)} />
                </label>
              ) : null}
              <label className="block text-sm">
                <span className="font-semibold text-muted">Assigned Sales Account</span>
                <select className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3" value={assignedEmailAccount} onChange={(event) => setAssignedEmailAccount(event.target.value)}>
                  {accountOptions.map((account) => (
                    <option key={account.emailAddress} value={account.emailAddress}>
                      {account.label || account.emailAddress} · {account.role}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button type="button" onClick={approveWithAssignment} disabled={Boolean(busy) || !assignedEmailAccount || (assignedUser === "Custom" && !customUser.trim())}>
                {busy === "APPROVED" ? "Assigning..." : "Save Assignment"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
