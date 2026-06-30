import { redirect } from "next/navigation";
import { LeadDetailClient } from "@/components/LeadDetailClient";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildLeadIntelligence } from "@/lib/services/lead-intelligence";
import { getLeadContactBlock } from "@/lib/services/send-safety";

export default async function LeadDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { mailbox?: string };
}) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      threads: {
        orderBy: { lastMessageAt: "desc" },
        include: {
          emails: { orderBy: { sentAt: "asc" } },
          drafts: { orderBy: { createdAt: "desc" } },
          sentEmails: { include: { engagement: true } }
        }
      },
      leadIntakes: { orderBy: { receivedAt: "desc" } },
      websiteVisits: true,
      proposalViews: true,
      activityLogs: { orderBy: { createdAt: "desc" }, take: 50 },
      qualification: true,
      clientBrain: true
    }
  });

  if (!lead) redirect("/leads");

  const whatsapp = await getLeadWhatsAppData(lead.id);
  const contactBlock = await getLeadContactBlock(lead.id);
  const leadWithOptionalWhatsApp = {
    ...lead,
    whatsappContact: whatsapp.contact,
    whatsappMessages: whatsapp.messages
  };

  return (
    <LeadDetailClient
      lead={leadWithOptionalWhatsApp}
      intelligence={buildLeadIntelligence(leadWithOptionalWhatsApp)}
      activeSalesEmail={pickSalesEmail(searchParams?.mailbox, leadWithOptionalWhatsApp.assignedEmailAccount, leadWithOptionalWhatsApp.currentMailbox)}
      contactBlock={contactBlock}
    />
  );
}

async function getLeadWhatsAppData(leadId: string) {
  const contactDelegate = (prisma as any).whatsAppContact;
  const messageDelegate = (prisma as any).whatsAppMessage;
  if (!contactDelegate || !messageDelegate) {
    return { contact: null, messages: [] };
  }
  try {
    const [contact, messages] = await Promise.all([
      contactDelegate.findUnique({ where: { leadId } }),
      messageDelegate.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 30 })
    ]);
    return { contact, messages };
  } catch {
    return { contact: null, messages: [] };
  }
}

function pickSalesEmail(...values: Array<string | null | undefined>) {
  const candidate = values
    .map((value) => decodeURIComponent(value || "").trim().toLowerCase())
    .find((value) => value && !value.startsWith("lead@"));
  return candidate || "abhay@aresourcepool.com";
}
