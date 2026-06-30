import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { EmailList } from "@/components/EmailList";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { RetrySentAppendButton } from "@/components/RetrySentAppendButton";
import { SyncButton } from "@/components/SyncButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emailWhereForMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";

export default async function SentPage({ searchParams }: { searchParams?: { mailbox?: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = await resolveMailboxContext(searchParams?.mailbox, "abhay@aresourcepool.com");
  const emails = await prisma.email.findMany({
    where: { AND: [emailWhereForMailbox(mailbox), { direction: "OUTBOUND" }] },
    orderBy: { sentAt: "desc" },
    take: 100,
    include: { thread: { include: { lead: true } } }
  });
  const appendFailures = await prisma.sentEmail.findMany({
    where: {
      appendStatus: "FAILED",
      thread: mailbox.accountId
        ? { accountId: mailbox.accountId }
        : { account: { emailAddress: { equals: mailbox.email, mode: "insensitive" } } }
    },
    orderBy: { sentAt: "desc" },
    include: { thread: { include: { lead: true } } },
    take: 20
  });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sent</h1>
          <p className="text-sm text-slate-500">Sent-folder emails imported through IMAP and SMTP-approved sends.</p>
        </div>
        <SyncButton />
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />
      {appendFailures.length ? (
        <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-bold text-amber-900">Sent folder copy warnings</h2>
          <p className="mt-1 text-sm text-amber-800">Email delivered successfully but could not be copied to Sent folder.</p>
          <div className="mt-3 space-y-3">
            {appendFailures.map((item) => (
              <div key={item.id} className="rounded-md border border-amber-200 bg-white p-3">
                <div className="font-semibold">{item.subject}</div>
                <div className="mt-1 text-sm text-slate-600">
                  To {item.toEmails.join(", ")} · <ClientDateTime value={item.sentAt} timeStyle="short" /> · {item.appendError || "IMAP append failed"}
                </div>
                <div className="mt-3">
                  <RetrySentAppendButton sentEmailId={item.id} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <EmailList emails={emails} />
    </AppShell>
  );
}
