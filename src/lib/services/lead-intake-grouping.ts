import type { PrismaClient } from "@prisma/client";

type LeadIntakeLike = {
  id: string;
  leadId?: string | null;
  subject?: string | null;
  originalSubject?: string | null;
  extractedClientEmail?: string | null;
  originalClientEmail?: string | null;
  extractedWebsite?: string | null;
  originalWebsite?: string | null;
  receivedAt?: Date | string | null;
  importedAt?: Date | string | null;
  status?: string | null;
  latestClientMessage?: string | null;
  originalClientMessage?: string | null;
  forwardedClientMessage?: string | null;
};

export function normalizeLeadIntakeEmail(value?: string | null) {
  const cleaned = (value || "")
    .toLowerCase()
    .replace(/\[mailto\]/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, " ")
    .trim();
  return cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || "";
}

export function normalizeLeadIntakeSubject(value?: string | null) {
  let subject = (value || "").toLowerCase().trim();
  subject = subject.replace(/\s+/g, " ");
  for (let index = 0; index < 12; index += 1) {
    const next = subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim();
    if (next === subject) break;
    subject = next;
  }
  return subject
    .replace(/[^\p{L}\p{N}\s@.#&+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getLeadIntakeConversationKey(item: LeadIntakeLike) {
  if (item.leadId) return `lead:${item.leadId}`;
  const email = normalizeLeadIntakeEmail(item.originalClientEmail || item.extractedClientEmail);
  const subject = normalizeLeadIntakeSubject(item.originalSubject || item.subject);
  if (email && subject) return `email-subject:${email}:${subject}`;
  const domain = normalizeWebsiteDomain(item.originalWebsite || item.extractedWebsite);
  if (domain && subject) return `website-subject:${domain}:${subject}`;
  return `item:${item.id}`;
}

export function groupLeadIntakeRows<T extends LeadIntakeLike>(rows: T[]) {
  const grouped = new Map<string, T>();
  for (const row of rows) {
    const key = getLeadIntakeConversationKey(row);
    const existing = grouped.get(key);
    if (!existing || shouldReplaceConversationRow(existing, row)) grouped.set(key, row);
  }
  return Array.from(grouped.values()).sort((a, b) => rowTime(b) - rowTime(a));
}

export async function findRelatedLeadIntakeMessages(prisma: PrismaClient, item: LeadIntakeLike) {
  const email = normalizeLeadIntakeEmail(item.originalClientEmail || item.extractedClientEmail);
  const subject = normalizeLeadIntakeSubject(item.originalSubject || item.subject);
  const candidates = await prisma.leadIntake.findMany({
    where: {
      OR: [
        item.leadId ? { leadId: item.leadId } : undefined,
        email ? { extractedClientEmail: { equals: email, mode: "insensitive" } } : undefined,
        email ? { originalClientEmail: { equals: email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    orderBy: [{ receivedAt: "asc" }, { importedAt: "asc" }]
  });
  return candidates.filter((candidate) => {
    if (item.leadId && candidate.leadId === item.leadId) return true;
    const candidateSubject = normalizeLeadIntakeSubject(candidate.originalSubject || candidate.subject);
    const candidateEmail = normalizeLeadIntakeEmail(candidate.originalClientEmail || candidate.extractedClientEmail);
    return Boolean(email && candidateEmail === email && subject && candidateSubject === subject);
  });
}

export async function findExistingLeadIdForLeadIntakeConversation(
  prisma: PrismaClient,
  input: { clientEmail?: string | null; originalSubject?: string | null; subject?: string | null; website?: string | null }
) {
  const email = normalizeLeadIntakeEmail(input.clientEmail);
  const subject = normalizeLeadIntakeSubject(input.originalSubject || input.subject);
  const domain = normalizeWebsiteDomain(input.website);
  if (!subject || (!email && !domain)) return null;
  const candidates = await prisma.leadIntake.findMany({
    where: {
      leadId: { not: null },
      OR: [
        email ? { extractedClientEmail: { equals: email, mode: "insensitive" } } : undefined,
        email ? { originalClientEmail: { equals: email, mode: "insensitive" } } : undefined,
        domain ? { extractedWebsite: { contains: domain, mode: "insensitive" } } : undefined,
        domain ? { originalWebsite: { contains: domain, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    select: {
      leadId: true,
      subject: true,
      originalSubject: true,
      receivedAt: true,
      importedAt: true
    },
    orderBy: [{ receivedAt: "desc" }, { importedAt: "desc" }],
    take: 50
  });
  const match = candidates.find((candidate) => normalizeLeadIntakeSubject(candidate.originalSubject || candidate.subject) === subject);
  return match?.leadId || null;
}

export async function mergeDuplicateLeadIntakes(prisma: PrismaClient, dryRun = true) {
  const rows = await prisma.leadIntake.findMany({
    where: { status: { in: ["WAITING_FOR_SANDIP", "NEEDS_REPLY", "CLIENT_REPLIED"] } },
    orderBy: [{ receivedAt: "asc" }, { importedAt: "asc" }]
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = getLeadIntakeConversationKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const merged: Array<{ parentId: string; duplicateIds: string[]; key: string }> = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const parent = group.find((row) => row.leadId) || group[0];
    const duplicates = group.filter((row) => row.id !== parent.id);
    merged.push({ key, parentId: parent.id, duplicateIds: duplicates.map((row) => row.id) });
    if (dryRun) continue;
    await prisma.leadIntake.updateMany({
      where: { id: { in: duplicates.map((row) => row.id) } },
      data: {
        leadId: parent.leadId,
        status: "ARCHIVED",
        extractionReason: `Merged into lead intake ${parent.id}. Raw email preserved.`
      }
    });
  }
  return merged;
}

function shouldReplaceConversationRow(current: LeadIntakeLike, next: LeadIntakeLike) {
  if (isClientReply(next) && !isClientReply(current)) return true;
  return rowTime(next) > rowTime(current);
}

function isClientReply(item: LeadIntakeLike) {
  return item.status === "NEEDS_REPLY" || item.status === "CLIENT_REPLIED" || Boolean(item.latestClientMessage);
}

function rowTime(item: LeadIntakeLike) {
  const value = item.receivedAt || item.importedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function normalizeWebsiteDomain(value?: string | null) {
  const raw = (value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}
