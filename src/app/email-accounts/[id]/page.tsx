import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmailAccountDetailTabs } from "@/components/EmailAccountDetailTabs";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeEmailAccount } from "@/lib/services/email-account-management";

export default async function EmailAccountDetailPage({ params }: { params: { id: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const account = await prisma.emailAccount.findUnique({
    where: { id: params.id },
    include: {
      _count: { select: { emails: true, leadIntakes: true, leadImportJobs: true } },
      leadImportJobs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { folders: { orderBy: { folderPath: "asc" } } }
      }
    }
  });
  if (!account) redirect("/email-accounts");

  const safeAccount = safeEmailAccount(account);

  return (
    <AppShell>
      <div className="mb-6">
        <Link href="/email-accounts" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft size={16} />
          Email Accounts
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
              <Mail size={14} className="text-accent" />
              {safeAccount.role}
            </div>
            <h1 className="page-title">{safeAccount.emailAddress}</h1>
            <p className="mt-1 text-sm text-muted">{safeAccount.description || safeAccount.label}</p>
          </div>
          <span className="rounded-full border border-line bg-subtle px-3 py-1 text-xs font-bold text-muted">{safeAccount.status}</span>
        </div>
      </div>

      <EmailAccountDetailTabs account={safeAccount} />
    </AppShell>
  );
}
