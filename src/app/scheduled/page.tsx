import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { ScheduledEmailsPanel } from "@/components/ScheduledEmailsPanel";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveMailboxContext } from "@/lib/services/mailbox-filter";

export default async function ScheduledEmailsPage({ searchParams }: { searchParams?: { mailbox?: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = await resolveMailboxContext(searchParams?.mailbox, "abhay@aresourcepool.com");
  const items = await prisma.scheduledEmail.findMany({
    where: {
      fromEmail: { equals: mailbox.email, mode: "insensitive" },
      status: { in: ["SCHEDULED", "QUEUED", "RETRY", "FAILED", "SENT"] }
    },
    orderBy: { scheduledAt: "asc" },
    include: { lead: true },
    take: 200
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Scheduled Emails</h1>
        <p className="text-sm text-slate-500">Review, edit, cancel, retry, or send approved scheduled emails.</p>
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />
      <ScheduledEmailsPanel items={items} />
    </AppShell>
  );
}
