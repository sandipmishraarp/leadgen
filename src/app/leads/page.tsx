import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assignedLeadWhereForMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";
import { getLeadContactBlock } from "@/lib/services/send-safety";

const contactFilters = [
  { id: "safe", label: "Safe to Contact" },
  { id: "blocked", label: "Do Not Contact" },
  { id: "bounced", label: "Bounced" },
  { id: "unsubscribed", label: "Unsubscribed" },
  { id: "not_interested", label: "Not Interested" }
] as const;

export default async function LeadsPage({ searchParams }: { searchParams?: { status?: string; mailbox?: string; contact?: string } }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = searchParams?.mailbox ? await resolveMailboxContext(searchParams.mailbox, "abhay@aresourcepool.com") : null;
  const leads = await prisma.lead.findMany({
    where: {
      AND: [
        ...(searchParams?.status ? [{ status: searchParams.status as any }] : []),
        ...(mailbox ? [assignedLeadWhereForMailbox(mailbox)] : [])
      ]
    },
    orderBy: { updatedAt: "desc" },
    include: { threads: { orderBy: { lastMessageAt: "desc" }, take: 1 } }
  });
  const blocks = await Promise.all(leads.map(async (lead) => [lead.id, await getLeadContactBlock(lead.id)] as const));
  const blocksByLeadId = new Map(blocks);
  const contactFilter = searchParams?.contact || "";
  const visibleLeads = leads.filter((lead) => {
    const block = blocksByLeadId.get(lead.id);
    if (contactFilter === "safe") return !block?.blocked;
    if (contactFilter === "blocked") return Boolean(block?.blocked);
    if (contactFilter === "bounced") return block?.code === "BOUNCED";
    if (contactFilter === "unsubscribed") return block?.code === "UNSUBSCRIBED";
    if (contactFilter === "not_interested") return block?.code === "NOT_INTERESTED";
    return true;
  });
  const filterText = [
    searchParams?.status ? `Status: ${searchParams.status.replaceAll("_", " ")}` : null,
    searchParams?.mailbox ? `Mailbox: ${searchParams.mailbox}` : null,
    contactFilter ? `Contact: ${contactFilter.replaceAll("_", " ")}` : null
  ].filter(Boolean).join(" · ");

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Lead Management</h1>
        <p className="text-sm text-slate-500">Track each email lead from new inquiry through reply, follow-up, won, or lost.</p>
        {filterText ? <div className="mt-2 inline-flex rounded-full border border-line bg-subtle px-3 py-1 text-xs font-semibold text-muted">{filterText}</div> : null}
      </div>
      {mailbox ? <MailboxViewingBanner email={mailbox.email} role={mailbox.role} /> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {contactFilters.map((filter) => {
          const params = new URLSearchParams();
          if (searchParams?.mailbox) params.set("mailbox", searchParams.mailbox);
          if (searchParams?.status) params.set("status", searchParams.status);
          params.set("contact", filter.id);
          const active = contactFilter === filter.id;
          return (
            <Link key={filter.id} href={`/leads?${params.toString()}`} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-line bg-white text-muted hover:text-ink"}`}>
              {filter.label}
            </Link>
          );
        })}
      </div>
      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="grid grid-cols-[1fr_190px_160px] border-b border-line bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-600">
          <span>Lead</span>
          <span>Status</span>
          <span>Latest thread</span>
        </div>
        <div className="divide-y divide-line">
          {visibleLeads.map((lead) => {
            const block = blocksByLeadId.get(lead.id);
            return (
            <div key={lead.id} className={`grid grid-cols-[1fr_190px_160px] gap-4 px-5 py-4 ${block?.blocked ? "bg-red-50/60" : ""}`}>
              <div>
                <Link href={`/leads/${lead.id}`} className="font-semibold text-accent">{lead.name || lead.email}</Link>
                <div className="mt-1 text-sm text-slate-500">{lead.email}</div>
                {block?.blocked ? <span className="mt-2 inline-flex rounded-full border border-red-200 bg-red-100 px-2 py-1 text-xs font-bold uppercase text-red-700">{block.label}</span> : null}
              </div>
              <LeadStatusSelect leadId={lead.id} status={lead.status} />
              <div className="text-sm">
                {lead.threads[0] ? (
                  <Link href={`/inbox/${lead.threads[0].id}`} className="font-medium text-accent">
                    Open
                  </Link>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </div>
            </div>
          );})}
          {!visibleLeads.length ? <div className="px-5 py-8 text-sm text-slate-500">No leads found for this mailbox.</div> : null}
        </div>
      </section>
    </AppShell>
  );
}
