import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LeadImportPanel } from "@/components/LeadImportPanel";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanupStaleLeadImportJobs } from "@/lib/services/lead-import";

export default async function LeadImportPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }
  await cleanupStaleLeadImportJobs();

  const [accounts, jobs] = await Promise.all([
    prisma.emailAccount.findMany({
      where: { isActive: true, accountType: "LEAD_INTAKE" },
      orderBy: { emailAddress: "asc" },
      select: { id: true, emailAddress: true, lastSyncedAt: true }
    }),
    prisma.leadImportJob.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { folders: { orderBy: { folderPath: "asc" } } }
    })
  ]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Lead Import</h1>
        <p className="text-sm text-slate-500">
          Discover lead@ IMAP folders, select provider folders, and import old leads in resumable batches.
        </p>
      </div>
      {accounts.length ? (
        <LeadImportPanel accounts={accounts} initialJobs={jobs} />
      ) : (
        <section className="rounded-lg border border-line bg-white p-5 text-sm text-slate-600">
          Configure a lead intake account in Settings first. Choose account type Lead intake for lead@aresourcepool.com.
        </section>
      )}
    </AppShell>
  );
}
