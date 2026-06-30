import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Mail, Plus, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { EmailAccountActions, SyncAllEmailAccountsButton } from "@/components/EmailAccountActions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function EmailAccountsPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const accounts = await prisma.emailAccount.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { emails: true, leadIntakes: true, leadImportJobs: true } },
      emails: { orderBy: { sentAt: "desc" }, take: 1 },
      leadImportJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      leadIntakes: { orderBy: { receivedAt: "desc" }, take: 1 }
    }
  });

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
            <ShieldCheck size={14} className="text-accent" />
            Multi-account foundation
          </div>
          <h1 className="page-title">Email Accounts</h1>
          <p className="mt-1 text-sm text-muted">Manage every mailbox, role, folder set, import status, and sync action from one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SyncAllEmailAccountsButton />
          <Link href="/email-accounts/new" className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} />
            Add Email Account
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {accounts.map((account) => {
          const folderCount = folderCountFromConfig(account.folderConfig);
          const importedEmails = account._count.emails + account._count.leadIntakes;
          const isLeadIntake = account.role === "Lead Intake" || account.accountType === "LEAD_INTAKE";
          const lastJob = account.leadImportJobs[0];
          return (
            <section key={account.id} className="premium-card p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${account.isActive && account.status !== "ERROR" ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <Link href={`/email-accounts/${account.id}`} className="truncate text-lg font-bold hover:text-accent">
                      {account.emailAddress}
                    </Link>
                  </div>
                  <div className="text-sm text-muted">{account.label}</div>
                </div>
                <span className="rounded-full border border-line bg-subtle px-3 py-1 text-xs font-bold text-muted">{account.status}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Role" value={account.role} />
                <Stat label={isLeadIntake ? "Folders" : "Inbox"} value={isLeadIntake ? String(folderCount || "Auto") : account._count.emails.toLocaleString()} />
                <Stat label={isLeadIntake ? "Imported Emails" : "Sent / Drafts"} value={isLeadIntake ? importedEmails.toLocaleString() : `${account._count.emails.toLocaleString()} / 0`} />
                <Stat label="Last Sync" value={<ClientDateTime value={account.lastSyncedAt} fallback="Never" timeStyle="short" />} />
                <Stat label="Jobs" value={String(account._count.leadImportJobs)} />
                <Stat label="Latest Job" value={lastJob ? lastJob.status : "None"} />
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <Link href={`/email-accounts/${account.id}`} className="btn-primary">Open</Link>
                <EmailAccountActions accountId={account.id} canImport={isLeadIntake} />
              </div>
            </section>
          );
        })}

        <Link href="/email-accounts/new" className="flex min-h-72 items-center justify-center rounded-lg border border-dashed border-line bg-subtle p-8 text-center transition hover:border-accent hover:bg-surface">
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white">
              <Mail size={22} />
            </div>
            <div className="font-bold">Add Email Account</div>
            <div className="mt-2 text-sm text-muted">Lead intake, sales, marketing, support, admin, or any future mailbox.</div>
          </div>
        </Link>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-bold">{value}</div>
    </div>
  );
}

function folderCountFromConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const folders = (value as { selectedFolders?: unknown }).selectedFolders;
  return Array.isArray(folders) ? folders.length : 0;
}
