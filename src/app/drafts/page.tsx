import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveMailboxContext, threadWhereForMailbox } from "@/lib/services/mailbox-filter";

export default async function DraftsPage({ searchParams }: { searchParams?: { mailbox?: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = await resolveMailboxContext(searchParams?.mailbox, "abhay@aresourcepool.com");
  const drafts = await prisma.draft.findMany({
    where: { thread: threadWhereForMailbox(mailbox) },
    orderBy: { updatedAt: "desc" },
    include: { thread: { include: { lead: true } } }
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Drafts</h1>
        <p className="text-sm text-slate-500">Reply and follow-up drafts awaiting approval.</p>
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />
      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="grid grid-cols-[130px_1fr_170px_120px] border-b border-line bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-600">
          <span>Type</span>
          <span>Draft</span>
          <span>Lead</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-line">
          {drafts.map((draft) => (
            <Link key={draft.id} href={`/inbox/${draft.threadId}`} className="grid grid-cols-[130px_1fr_170px_120px] gap-4 px-5 py-4 hover:bg-slate-50">
              <div className="text-sm font-semibold">{draft.draftType}</div>
              <div>
                <div className="font-semibold">{draft.subject}</div>
                <div className="mt-1 text-sm text-slate-500">{draft.body.replace(/\s+/g, " ").slice(0, 160)}</div>
              </div>
              <div className="text-sm text-slate-500">{draft.thread.lead?.email || "Unlinked"}</div>
              <div className="text-sm">{draft.status}</div>
            </Link>
          ))}
          {!drafts.length ? <div className="px-5 py-8 text-sm text-slate-500">No drafts found for this mailbox.</div> : null}
        </div>
      </section>
    </AppShell>
  );
}
