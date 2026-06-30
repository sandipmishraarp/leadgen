import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmailList, FilterTabs } from "@/components/EmailList";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { SyncButton } from "@/components/SyncButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emailWhereForMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";

function whereForFilter(filter: string) {
  if (filter === "inbox") return { direction: "INBOUND" as const };
  if (filter === "sent") return { direction: "OUTBOUND" as const };
  if (filter === "needs-follow-up") return { thread: { lead: { status: "FOLLOW_UP_NEEDED" as const } } };
  if (filter === "replied") return { thread: { lead: { status: "REPLIED" as const } } };
  if (filter === "no-reply") return { thread: { lead: { waitingForReply: true } } };
  if (filter === "draft-created") return { thread: { lead: { status: "DRAFT_CREATED" as const } } };
  return {};
}

export default async function EmailsPage({
  searchParams
}: {
  searchParams: { filter?: string; take?: string; mailbox?: string };
}) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const filter = searchParams.filter || "all";
  const take = Math.min(Number(searchParams.take || 100), 500);
  const mailbox = await resolveMailboxContext(searchParams.mailbox, "abhay@aresourcepool.com");
  const emails = await prisma.email.findMany({
    where: { AND: [emailWhereForMailbox(mailbox), whereForFilter(filter)] },
    orderBy: { sentAt: "desc" },
    take,
    include: { thread: { include: { lead: true } } }
  });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">All Emails</h1>
          <p className="text-sm text-slate-500">Combined Inbox and Sent view with follow-up filters.</p>
        </div>
        <SyncButton />
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />
      <FilterTabs active={filter} mailbox={mailbox.email} />
      <EmailList emails={emails} />
      <div className="mt-4">
        <Link
          href={`/emails?filter=${filter}&take=${Math.min(take + 100, 500)}&mailbox=${encodeURIComponent(mailbox.email)}`}
          className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold"
        >
          Load more
        </Link>
      </div>
    </AppShell>
  );
}
