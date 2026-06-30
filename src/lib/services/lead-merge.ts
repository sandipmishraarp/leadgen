import type { Prisma, LeadStatus } from "@prisma/client";

type LeadMergeInput = {
  clientEmail: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  service?: string | null;
  source: string;
  status?: LeadStatus;
  originalClientMessage?: string | null;
  notes?: string | null;
  clientEmailConfidence?: number | null;
  clientEmailReason?: string | null;
  currentMailbox?: string | null;
};

export async function mergeLeadByClientEmail(tx: Prisma.TransactionClient, input: LeadMergeInput) {
  const email = input.clientEmail.toLowerCase().trim();
  const notes = buildNotes(input.notes, input.originalClientMessage);

  return tx.lead.upsert({
    where: { email },
    create: {
      email,
      name: input.name || undefined,
      company: input.company || undefined,
      phone: input.phone || undefined,
      website: input.website || undefined,
      country: input.country || undefined,
      service: input.service || undefined,
      source: input.source,
      status: input.status || "WAITING_FOR_SANDIP",
      notes,
      clientEmailConfidence: input.clientEmailConfidence ?? undefined,
      clientEmailReason: input.clientEmailReason || undefined,
      currentMailbox: input.currentMailbox || "lead@aresourcepool.com"
    },
    update: {
      name: input.name || undefined,
      company: input.company || undefined,
      phone: input.phone || undefined,
      website: input.website || undefined,
      country: input.country || undefined,
      service: input.service || undefined,
      status: input.status || undefined,
      clientEmailConfidence: input.clientEmailConfidence ?? undefined,
      clientEmailReason: input.clientEmailReason || undefined
    }
  });
}

function buildNotes(notes?: string | null, originalClientMessage?: string | null) {
  return [notes, originalClientMessage ? `Original message:\n${originalClientMessage}` : ""]
    .filter(Boolean)
    .join("\n\n") || undefined;
}
