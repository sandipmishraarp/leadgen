import { prisma } from "@/lib/prisma";

export function normalizeSubject(subject: string) {
  return subject
    .replace(/^(\s*(re|fw|fwd):\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function snippetFromText(text?: string | null) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

export async function findOrCreateLead(input: { email: string; name?: string | null }) {
  return prisma.lead.upsert({
    where: { email: input.email.toLowerCase() },
    create: {
      email: input.email.toLowerCase(),
      name: input.name || undefined,
      status: "WAITING_FOR_SANDIP"
    },
    update: {
      name: input.name || undefined
    }
  });
}

export function threadKey(subject: string, externalEmail?: string | null) {
  const subjectKey = normalizeSubject(subject) || "(no subject)";
  return `${subjectKey}::${(externalEmail || "unknown").toLowerCase()}`;
}

export async function upsertThread(input: {
  accountId: string;
  leadId?: string;
  subject: string;
  lastMessageAt: Date;
  externalEmail?: string | null;
  references?: string | null;
  inReplyTo?: string | null;
}) {
  const referencedIds = [input.inReplyTo, ...(input.references?.split(/\s+/) || [])].filter(Boolean) as string[];
  if (referencedIds.length) {
    const referencedEmail = await prisma.email.findFirst({
      where: {
        accountId: input.accountId,
        messageId: { in: referencedIds }
      },
      include: { thread: true }
    });
    if (referencedEmail) {
      return prisma.emailThread.update({
        where: { id: referencedEmail.threadId },
        data: {
          leadId: input.leadId || referencedEmail.thread.leadId,
          lastMessageAt: input.lastMessageAt
        }
      });
    }
  }

  const normalizedKey = threadKey(input.subject, input.externalEmail);
  return prisma.emailThread.upsert({
    where: {
      accountId_normalizedKey: {
        accountId: input.accountId,
        normalizedKey
      }
    },
    create: {
      accountId: input.accountId,
      leadId: input.leadId,
      subject: input.subject || "(no subject)",
      normalizedKey,
      lastMessageAt: input.lastMessageAt,
      messageCount: 0
    },
    update: {
      leadId: input.leadId,
      lastMessageAt: input.lastMessageAt
    }
  });
}
