import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { assertLeadIntakeMailbox, leadIntakeWhereForMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";

const statusSchema = z
  .enum(["WAITING_FOR_SANDIP", "NEEDS_REPLY", "CLIENT_REPLIED", "APPROVED", "REJECTED", "HOLD", "ARCHIVED"])
  .optional();
const filterSchema = z
  .enum(["all", "latest", "waiting", "needs-reply", "approved", "rejected", "hold", "archived", "low-confidence", "manual-confirmation", "needs-sandip-acceptance", "today", "this-week", "new-since-last-sync"])
  .optional();
const bulkSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "HOLD", "ARCHIVE"]),
  ids: z.array(z.string()).min(1)
});

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const filter = filterSchema.parse(searchParams.get("filter") || undefined);
    const status = statusSchema.parse(searchParams.get("status") || filterToStatus(filter));
    const mailbox = await resolveMailboxContext(searchParams.get("mailbox") || searchParams.get("activeAccountEmail"), "lead@aresourcepool.com");
    assertLeadIntakeMailbox(mailbox);
    const where = buildLeadIntakeWhere(mailbox, searchParams, status, filter);
    const items = await prisma.leadIntake.findMany({
      where,
      orderBy: sortOrder(searchParams.get("sort")),
      take: 50,
      select: leadIntakeListSelect()
    });
    const statsBase = leadIntakeWhereForMailbox(mailbox);
    const startToday = startOfDay(new Date());
    const startWeek = daysAgo(7);
    const [total, waiting, approved, rejected, hold, today, account] = await Promise.all([
      prisma.leadIntake.count({ where: statsBase }),
      prisma.leadIntake.count({ where: { AND: [statsBase, { status: "WAITING_FOR_SANDIP" }] } }),
      prisma.leadIntake.count({ where: { AND: [statsBase, { status: "APPROVED" }] } }),
      prisma.leadIntake.count({ where: { AND: [statsBase, { status: "REJECTED" }] } }),
      prisma.leadIntake.count({ where: { AND: [statsBase, { status: "HOLD" }] } }),
      prisma.leadIntake.count({ where: { AND: [statsBase, { receivedAt: { gte: startToday } }] } }),
      mailbox.accountId ? prisma.emailAccount.findUnique({ where: { id: mailbox.accountId }, select: { lastSyncedAt: true, connectionStatus: true } }) : null
    ]);
    const lastSyncStartedAt = getLastSyncStartedAt(account?.connectionStatus);
    const newSinceLastSync = lastSyncStartedAt
      ? await prisma.leadIntake.count({ where: { AND: [statsBase, { importedAt: { gte: lastSyncStartedAt } }] } })
      : await prisma.leadIntake.count({ where: { AND: [statsBase, { importedAt: { gte: startWeek } }] } });
    return jsonOk({ items, stats: { total, waiting, approved, rejected, hold, today, newSinceLastSync } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = bulkSchema.parse(await request.json());
    const status = input.action === "APPROVE" ? "APPROVED" : input.action === "REJECT" ? "REJECTED" : input.action === "HOLD" ? "HOLD" : "ARCHIVED";
    const result = await prisma.leadIntake.updateMany({
      where: { id: { in: input.ids } },
      data: { status }
    });
    await prisma.lead.updateMany({
      where: { leadIntakes: { some: { id: { in: input.ids } } } },
      data: { status }
    }).catch(() => null);
    return jsonOk({ updated: result.count });
  } catch (error) {
    return jsonError(error);
  }
}

function buildLeadIntakeWhere(mailbox: any, searchParams: URLSearchParams, status?: string, filter?: string) {
  const parts: any[] = [leadIntakeWhereForMailbox(mailbox, status, filterToExtraWhere(filter))];
  const q = searchParams.get("q")?.trim();
  if (q) parts.push({ OR: leadIntakeSearchOr(q) });
  const searchFields = [
    ["clientName", "extractedName"],
    ["clientEmail", "extractedClientEmail"],
    ["subject", "subject"],
    ["company", "extractedCompany"],
    ["websiteSearch", "extractedWebsite"],
    ["providerName", "sourceProviderName"],
    ["providerEmail", "leadGeneratorEmail"],
    ["body", "rawText"],
    ["sourceMailbox", "accountEmail"],
    ["sourceFolder", "sourceFolderPath"],
    ["country", "extractedCountry"],
    ["service", "extractedService"]
  ] as const;
  for (const [param, field] of searchFields) {
    const value = searchParams.get(param)?.trim();
    if (value) parts.push({ [field]: { contains: value, mode: "insensitive" } });
  }
  const provider = searchParams.get("provider")?.trim();
  if (provider) parts.push({ OR: [{ sourceProviderName: { contains: provider, mode: "insensitive" } }, { detectedProviderName: { contains: provider, mode: "insensitive" } }] });
  const confidenceMin = searchParams.get("confidenceMin")?.trim() ? Number(searchParams.get("confidenceMin")) : NaN;
  const confidenceMax = searchParams.get("confidenceMax")?.trim() ? Number(searchParams.get("confidenceMax")) : NaN;
  if (!Number.isNaN(confidenceMin)) parts.push({ extractionConfidence: { gte: confidenceMin } });
  if (!Number.isNaN(confidenceMax)) parts.push({ extractionConfidence: { lte: confidenceMax } });
  if (searchParams.get("websitePresence") === "has") parts.push({ extractedWebsite: { not: null } });
  if (searchParams.get("websitePresence") === "missing") parts.push({ OR: [{ extractedWebsite: null }, { extractedWebsite: "" }] });
  if (searchParams.get("manualReview") === "true") parts.push({ needsManualConfirmation: true });

  const now = new Date();
  const datePreset = searchParams.get("date");
  if (filter === "today" || datePreset === "today") parts.push({ receivedAt: { gte: startOfDay(now) } });
  if (datePreset === "yesterday") {
    const start = startOfDay(daysAgo(1));
    parts.push({ receivedAt: { gte: start, lt: startOfDay(now) } });
  }
  if (filter === "this-week" || datePreset === "last7") parts.push({ receivedAt: { gte: daysAgo(7) } });
  if (datePreset === "last30") parts.push({ receivedAt: { gte: daysAgo(30) } });
  const receivedRange = dateRange(searchParams.get("receivedFrom"), searchParams.get("receivedTo"));
  if (receivedRange) parts.push({ receivedAt: receivedRange });
  const importedRange = dateRange(searchParams.get("importedFrom"), searchParams.get("importedTo"));
  if (importedRange) parts.push({ importedAt: importedRange });
  if (filter === "new-since-last-sync") parts.push({ importedAt: { gte: daysAgo(1) } });
  return parts.length === 1 ? parts[0] : { AND: parts };
}

function leadIntakeSearchOr(value: string) {
  return [
    "extractedName",
    "extractedClientEmail",
    "subject",
    "extractedCompany",
    "extractedWebsite",
    "sourceProviderName",
    "detectedProviderName",
    "leadGeneratorEmail",
    "fromEmail",
    "sourceFolder",
    "sourceFolderPath",
    "extractedCountry",
    "extractedService",
    "rawText",
    "originalClientMessage",
    "forwardedClientMessage"
  ].map((field) => ({ [field]: { contains: value, mode: "insensitive" } }));
}

function leadIntakeListSelect() {
  return {
    id: true,
    accountId: true,
    accountEmail: true,
    leadId: true,
    messageId: true,
    fromEmail: true,
    fromName: true,
    subject: true,
    leadGeneratorEmail: true,
    extractedName: true,
    extractedClientEmail: true,
    extractedWebsite: true,
    extractedPhone: true,
    extractedCountry: true,
    extractedService: true,
    extractedCompany: true,
    forwardedClientMessage: true,
    originalClientMessage: true,
    originalClientName: true,
    originalClientEmail: true,
    originalWebsite: true,
    originalCompany: true,
    originalSubject: true,
    latestClientMessage: true,
    detectedIntent: true,
    requestedItems: true,
    recommendedReplyType: true,
    leadSourceType: true,
    conversationType: true,
    replyMode: true,
    forwardedBy: true,
    providerEmail: true,
    sourceFolder: true,
    sourceFolderPath: true,
    sourceProviderName: true,
    detectedProviderName: true,
    rejectedEmails: true,
    extractionConfidence: true,
    extractionReason: true,
    needsManualConfirmation: true,
    approvalStatus: true,
    sandipReviewRequired: true,
    sandipDecisionStatus: true,
    reviewerEmail: true,
    reviewerComment: true,
    reviewerCommentAt: true,
    allowContinueAsAbhay: true,
    status: true,
    receivedAt: true,
    importedAt: true,
    updatedAt: true,
    lead: { select: { id: true, status: true } },
    account: { select: { id: true, emailAddress: true, role: true } }
  };
}

function filterToStatus(filter?: string) {
  const map: Record<string, string> = {
    "needs-reply": "NEEDS_REPLY",
    approved: "APPROVED",
    rejected: "REJECTED",
    hold: "HOLD",
    archived: "ARCHIVED"
  };
  return filter ? map[filter] : undefined;
}

function filterToExtraWhere(filter?: string) {
  if (filter === "low-confidence") return { extractionConfidence: { lt: 80 } };
  if (filter === "manual-confirmation") return { needsManualConfirmation: true };
  if (filter === "needs-sandip-acceptance") return { sandipReviewRequired: true, sandipDecisionStatus: "pending" };
  if (filter === "latest") return { status: { in: ["WAITING_FOR_SANDIP", "NEEDS_REPLY"] } };
  if (filter === "waiting") return { status: { in: ["WAITING_FOR_SANDIP", "NEEDS_REPLY"] } };
  return undefined;
}

function sortOrder(sort?: string | null) {
  if (sort === "oldest") return [{ receivedAt: "asc" as const }, { importedAt: "asc" as const }];
  if (sort === "highest-confidence") return [{ extractionConfidence: "desc" as const }, { receivedAt: "desc" as const }];
  if (sort === "lowest-confidence") return [{ extractionConfidence: "asc" as const }, { receivedAt: "desc" as const }];
  if (sort === "client-name") return [{ extractedName: "asc" as const }, { receivedAt: "desc" as const }];
  if (sort === "provider") return [{ sourceProviderName: "asc" as const }, { detectedProviderName: "asc" as const }];
  if (sort === "country") return [{ extractedCountry: "asc" as const }, { receivedAt: "desc" as const }];
  return [{ receivedAt: "desc" as const }, { importedAt: "desc" as const }];
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function daysAgo(days: number) {
  const next = new Date();
  next.setDate(next.getDate() - days);
  return next;
}

function getLastSyncStartedAt(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).lastSyncStartedAt;
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateRange(from?: string | null, to?: string | null) {
  const range: Record<string, Date> = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return Object.keys(range).length ? range : null;
}
