import Link from "next/link";
import { Mail, Plus, RefreshCw } from "lucide-react";
import { SyncAllEmailAccountsButton } from "@/components/EmailAccountActions";

export function EmailAccountsDashboardWidget({
  connectedAccounts,
  totalImportedEmails,
  todaysSync,
  failedSync,
  runningImports
}: {
  connectedAccounts: number;
  totalImportedEmails: number;
  todaysSync: number;
  failedSync: number;
  runningImports: number;
}) {
  return (
    <section className="premium-card p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-subtle px-3 py-1 text-xs font-semibold text-muted">
            <Mail size={14} className="text-accent" />
            Email Accounts
          </div>
          <h2 className="font-bold">Account Operations</h2>
        </div>
        <RefreshCw size={18} className="text-accent" />
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <WidgetStat label="Connected" value={connectedAccounts} />
        <WidgetStat label="Imported" value={totalImportedEmails} />
        <WidgetStat label="Today Sync" value={todaysSync} />
        <WidgetStat label="Failed Sync" value={failedSync} />
        <WidgetStat label="Running Imports" value={runningImports} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/email-accounts/new" className="btn-primary inline-flex items-center gap-2">
          <Plus size={16} />
          Add Account
        </Link>
        <SyncAllEmailAccountsButton />
        <Link href="/email-accounts" className="btn-secondary">Import All</Link>
      </div>
    </section>
  );
}

function WidgetStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="text-xl font-bold">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}
