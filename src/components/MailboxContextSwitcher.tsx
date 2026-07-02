"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";

export type MailboxAccount = {
  id: string;
  emailAddress: string;
  label?: string;
  role: string;
  status?: string;
  accountType?: string;
};

const STORAGE_KEY = "active-mailbox-context";

export function useMailboxContext() {
  const [accounts, setAccounts] = useState<MailboxAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const mailboxFromUrl = url.searchParams.get("mailbox");
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setSelectedId(saved);
    apiFetch("/api/mailbox-context")
      .then((response) => response.ok ? response.json() : { accounts: [] })
      .then((data) => {
        const nextAccounts = data.accounts || [];
        setAccounts(nextAccounts);
        const urlAccount = mailboxFromUrl
          ? nextAccounts.find((account: MailboxAccount) =>
              account.emailAddress.toLowerCase() === mailboxFromUrl.toLowerCase() || account.id === mailboxFromUrl
            )
          : null;
        const selected = urlAccount?.id || saved || nextAccounts[0]?.id;
        if (selected) {
          setSelectedId(selected);
          window.localStorage.setItem(STORAGE_KEY, selected);
        }
      })
      .catch(() => setAccounts([]));
  }, []);

  const activeAccount = useMemo(() => {
    return accounts.find((account) => account.id === selectedId) || accounts[0] || null;
  }, [accounts, selectedId]);

  function selectMailbox(id: string) {
    setSelectedId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
    const account = accounts.find((item) => item.id === id);
    if (account) {
      const url = new URL(window.location.href);
      url.searchParams.set("mailbox", account.emailAddress);
      window.history.replaceState(null, "", url.toString());
      window.location.href = url.toString();
    }
    window.dispatchEvent(new CustomEvent("mailbox-context-changed", { detail: { id } }));
  }

  return { accounts, activeAccount, selectedId, selectMailbox };
}

export function MailboxContextSwitcher({
  accounts,
  activeAccount,
  selectedId,
  onSelect
}: {
  accounts: MailboxAccount[];
  activeAccount: MailboxAccount | null;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative min-w-[260px]">
      <label className="sr-only" htmlFor="mailbox-context">Current mailbox</label>
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent">
        <Mail size={16} />
      </div>
      <select
        id="mailbox-context"
        className="h-10 w-full appearance-none rounded-xl border border-line bg-surface py-1 pl-9 pr-9 text-sm font-semibold text-ink shadow-sm outline-none transition focus:border-accent"
        value={selectedId || activeAccount?.id || ""}
        onChange={(event) => onSelect(event.target.value)}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {displayName(account)} · {account.role}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function MailboxContextBadge({ account }: { account: MailboxAccount | null }) {
  if (!account) {
    return <div className="rounded-2xl border border-line bg-subtle p-3 text-sm text-muted">Mailbox context loading...</div>;
  }
  return (
    <div className="rounded-2xl border border-line bg-subtle p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Current mailbox</div>
      <div className="mt-2 truncate text-sm font-bold">{displayName(account)}</div>
      <div className="mt-1 text-xs text-muted">{account.emailAddress} · {account.role}</div>
    </div>
  );
}

export function isLeadMailbox(account: MailboxAccount | null) {
  if (!account) return false;
  if (account.role === "Lead Intake") return true;
  if (account.role && account.role !== "Lead Intake") return false;
  return account.accountType === "LEAD_INTAKE" || /lead@/i.test(account.emailAddress || "");
}

function displayName(account: MailboxAccount) {
  return account.label || account.emailAddress.split("@")[0] || account.emailAddress;
}
