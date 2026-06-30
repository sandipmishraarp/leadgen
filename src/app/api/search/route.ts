import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { emailWhereForMailbox, isLeadIntakeMailbox, leadIntakeWhereForMailbox, resolveMailboxContext, threadWhereForMailbox } from "@/lib/services/mailbox-filter";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";
    if (q.length < 2) return jsonOk(emptyResults());

    const mailbox = await resolveMailboxContext(searchParams.get("mailbox") || searchParams.get("activeAccountEmail"), "lead@aresourcepool.com");
    const isLeadMailboxContext = isLeadIntakeMailbox(mailbox);
    const leadScope = isLeadMailboxContext
      ? {}
      : { OR: [{ assignedEmailAccount: { equals: mailbox.email, mode: "insensitive" as const } }, { currentMailbox: { equals: mailbox.email, mode: "insensitive" as const } }] };
    const emailScope = emailWhereForMailbox(mailbox);
    const threadScope = threadWhereForMailbox(mailbox);
    const text = { contains: q, mode: "insensitive" as const };
    const normalized = q.toLowerCase();
    const rawThreadIds = await searchThreadIdsByEmailArrays(q, mailbox);

    const [leads, leadIntake, threads, emails, sentEmails, drafts, scheduled, tracking, whatsapp] = await Promise.all([
      prisma.lead.findMany({
        where: {
          AND: [
            leadScope,
            {
              OR: [
                { name: text },
                { email: text },
                { company: text },
                { website: text },
                { phone: text },
                { service: text },
                { country: text },
                { notes: text },
                { source: text },
                { threads: { some: threadSearchWhere(text, rawThreadIds) } },
                { leadIntakes: { some: { OR: leadIntakeSearchOr(q) } } },
                { websiteVisits: { some: { OR: [{ email: text }, { pageUrl: text }] } } },
                { proposalViews: { some: { OR: [{ proposalId: text }, { proposalUrl: text }, { engagementId: text }] } } }
              ]
            }
          ]
        },
        orderBy: { updatedAt: "desc" },
        take: 5
      }),
      isLeadMailboxContext
        ? prisma.leadIntake.findMany({
            where: { AND: [leadIntakeWhereForMailbox(mailbox), { OR: leadIntakeSearchOr(q) }] },
            orderBy: [{ receivedAt: "desc" }, { importedAt: "desc" }],
            take: 5
          })
        : Promise.resolve([]),
      prisma.emailThread.findMany({
        where: { AND: [threadScope, threadSearchWhere(text, rawThreadIds)] },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 5,
        include: { lead: true, emails: { orderBy: { sentAt: "desc" }, take: 1 } }
      }),
      prisma.email.findMany({
        where: {
          AND: [
            emailScope,
            {
              OR: [
                { threadId: { in: rawThreadIds } },
                ...emailSearchOr(q, text)
              ]
            }
          ]
        },
        orderBy: { sentAt: "desc" },
        take: 5,
        include: { thread: { select: { id: true, leadId: true, subject: true, lastMessageAt: true, lead: true } } }
      }),
      prisma.sentEmail.findMany({
        where: { AND: [{ thread: threadScope }, { OR: [{ threadId: { in: rawThreadIds } }, ...sentSearchOr(q, text)] }] },
        orderBy: { sentAt: "desc" },
        take: 5,
        include: { thread: { include: { lead: true } }, engagement: true }
      }),
      prisma.draft.findMany({
        where: { AND: [{ thread: threadScope }, { OR: [{ threadId: { in: rawThreadIds } }, ...draftSearchOr(q, text)] }] },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: { thread: { include: { lead: true } } }
      }),
      prisma.scheduledEmail.findMany({
        where: { AND: [{ fromEmail: { equals: mailbox.email, mode: "insensitive" as const } }, { OR: [{ toEmail: text }, { cc: text }, { bcc: text }, { subject: text }, { body: text }, { bodyHtml: text }, { bodyText: text }, { status: text }] }] },
        orderBy: { scheduledAt: "desc" },
        take: 5,
        include: { lead: true }
      }),
      prisma.emailEngagement.findMany({
        where: {
          OR: [
            { id: text },
            { sentEmailId: text },
            { linkClicks: { some: { OR: [{ url: text }, { engagementId: text }] } } },
            { proposalViewRows: { some: { OR: [{ proposalId: text }, { proposalUrl: text }, { engagementId: text }] } } }
          ]
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: { sentEmail: { include: { thread: { include: { lead: true } } } }, proposalViewRows: true }
      }),
      safeWhatsAppFindMany({
        where: {
          AND: [
            isLeadMailboxContext ? {} : { lead: { is: leadScope } },
            { OR: [{ phone: text }, { body: text }, { status: text }, { lead: { email: text } }, { lead: { name: text } }, { lead: { company: text } }] }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { lead: true }
      })
    ]);

    return jsonOk({
      groups: {
        leads: rankResults(leads.map((item) => result("Lead", item.name || item.email || "Lead", item.email, item.service || item.company, item.status, item.updatedAt, `/leads/${item.id}`, matchedIn(q, {
          "Client Name": item.name,
          Email: item.email,
          Company: item.company,
          Website: item.website,
          Phone: item.phone,
          Country: item.country,
          Service: item.service,
          Notes: item.notes
        }))), normalized),
        leadIntake: rankResults(leadIntake.map((item) => result("Lead Intake", item.extractedName || item.extractedClientEmail || item.subject, item.extractedClientEmail || item.fromEmail, item.subject, item.status, item.receivedAt, `/lead-intake?mailbox=${encodeURIComponent(mailbox.email)}&q=${encodeURIComponent(q)}`, matchedIn(q, {
          "Client Name": item.extractedName,
          Email: item.extractedClientEmail,
          Subject: item.subject,
          Company: item.extractedCompany,
          Website: item.extractedWebsite,
          "Provider Name": item.sourceProviderName || item.detectedProviderName,
          "Provider Email": item.leadGeneratorEmail || item.fromEmail,
          Folder: item.sourceFolderPath || item.sourceFolder,
          Body: item.rawText || item.originalClientMessage || item.forwardedClientMessage
        }))), normalized),
        threads: rankResults(threads.map((item) => result("Thread", item.lead?.name || item.subject, item.lead?.email || latestEmailAddress(item.emails[0]), item.emails[0]?.subject || item.subject, "Thread", item.lastMessageAt || item.updatedAt, item.leadId ? `/leads/${item.leadId}` : `/inbox/${item.id}`, matchedIn(q, {
          "Thread Subject": item.subject,
          "Latest Subject": item.emails[0]?.subject,
          "Client Name": item.lead?.name,
          Email: item.lead?.email || latestEmailAddress(item.emails[0]),
          Body: item.emails[0]?.textBody || item.emails[0]?.snippet
        }))), normalized),
        emails: rankResults(emails.map((item) => result(item.direction === "OUTBOUND" ? "Sent" : "Email", item.fromName || item.fromEmail, allEmailAddresses(item).join(", "), item.subject, item.direction, item.sentAt, item.thread?.leadId ? `/leads/${item.thread.leadId}` : `/inbox/${item.threadId}`, matchedIn(q, {
          "Sender Name": item.fromName,
          "Sender Email": item.fromEmail,
          "Recipient Email": allEmailAddresses(item).join(" "),
          Subject: item.subject,
          Body: item.textBody || item.snippet,
          "Message-ID": item.messageId,
          Folder: item.sourceFolderPath || item.sourceFolder || item.folder
        }))), normalized),
        sent: rankResults(sentEmails.map((item) => result("Sent Email", item.thread.lead?.name || item.toEmails.join(", "), item.thread.lead?.email || item.toEmails.join(", "), item.subject, "Sent", item.sentAt, item.thread.leadId ? `/leads/${item.thread.leadId}` : "/sent", matchedIn(q, {
          Email: item.toEmails.join(" "),
          Subject: item.subject,
          Body: item.bodyText || item.body || item.bodyHtml,
          "Tracking ID": item.engagement?.id
        }))), normalized),
        drafts: rankResults(drafts.map((item) => result("Draft", item.thread.lead?.name || item.toEmails.join(", "), item.thread.lead?.email || item.toEmails.join(", "), item.subject, item.status, item.updatedAt, item.thread.leadId ? `/leads/${item.thread.leadId}#drafts-composer` : "/drafts", matchedIn(q, {
          Email: [...item.toEmails, ...item.ccEmails, ...item.bccEmails].join(" "),
          Subject: item.subject,
          Body: item.bodyText || item.body || item.bodyHtml,
          Status: item.status
        }))), normalized),
        scheduled: rankResults(scheduled.map((item) => result("Scheduled", item.lead?.name || item.toEmail, item.lead?.email || item.toEmail, item.subject, item.status, item.scheduledAt, item.leadId ? `/leads/${item.leadId}` : "/scheduled", matchedIn(q, {
          Email: [item.toEmail, item.cc, item.bcc].filter(Boolean).join(" "),
          Subject: item.subject,
          Body: item.bodyText || item.body || item.bodyHtml,
          Status: item.status
        }))), normalized),
        tracking: tracking.map((item) => result("Tracking", item.sentEmail.thread.lead?.name || item.id, item.sentEmail.thread.lead?.email || item.sentEmail.toEmails.join(", "), item.sentEmail.subject, item.leadScore, item.updatedAt, item.sentEmail.thread.leadId ? `/leads/${item.sentEmail.thread.leadId}` : "/dashboard", matchedIn(q, {
          "Tracking ID": item.id,
          "Proposal ID": item.proposalViewRows?.map((view) => view.proposalId).filter(Boolean).join(" "),
          Email: item.sentEmail.toEmails.join(" "),
          Subject: item.sentEmail.subject
        }))),
        whatsapp: whatsapp.map((item: any) => result("WhatsApp", item.lead?.name || item.phone, item.lead?.email || item.phone, item.body.slice(0, 90), item.status, item.createdAt, `/leads/${item.leadId}#whatsapp`, matchedIn(q, {
          "Client Name": item.lead?.name,
          Email: item.lead?.email,
          "WhatsApp Number": item.phone,
          Body: item.body,
          Status: item.status
        }))),
        followups: rankResults(leads
          .filter((item) => item.status === "FOLLOW_UP_NEEDED" || item.waitingForReply)
          .map((item) => result("Follow-up", item.name || item.email, item.email, item.service, item.status, item.nextFollowUpAt || item.updatedAt, `/leads/${item.id}`, matchedIn(q, {
            "Client Name": item.name,
            Email: item.email,
            Service: item.service,
            Company: item.company
          }))), normalized)
          .slice(0, 5)
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}

function emptyResults() {
  return { groups: { leads: [], leadIntake: [], threads: [], emails: [], sent: [], drafts: [], scheduled: [], tracking: [], whatsapp: [], followups: [] } };
}

function safeWhatsAppFindMany(args: any) {
  const delegate = (prisma as any).whatsAppMessage;
  return typeof delegate?.findMany === "function" ? delegate.findMany(args).catch(() => []) : Promise.resolve([]);
}

function result(type: string, title: string | null, email: string | null, subject: string | null, status: string | null, date: Date | null, href: string, matchedIn: string[] = []) {
  return { type, title: title || "Untitled", email: email || "", subject: subject || "", status: status || type, date, href, matchedIn };
}

function threadSearchWhere(text: { contains: string; mode: "insensitive" }, rawThreadIds: string[]) {
  return {
    OR: [
      { id: { in: rawThreadIds } },
      { subject: text },
      { normalizedKey: text },
      { lead: { is: { OR: [{ name: text }, { email: text }, { company: text }, { website: text }, { phone: text }, { service: text }, { notes: text }] } } },
      { emails: { some: { OR: emailSearchOr(text.contains, text) } } },
      { sentEmails: { some: { OR: sentSearchOr(text.contains, text) } } },
      { drafts: { some: { OR: draftSearchOr(text.contains, text) } } }
    ]
  };
}

function emailSearchOr(value: string, text: { contains: string; mode: "insensitive" }) {
  const exact = value.trim().toLowerCase();
  return [
    { fromName: text },
    { fromEmail: text },
    { toEmails: { has: exact } },
    { ccEmails: { has: exact } },
    { bccEmails: { has: exact } },
    { messageId: text },
    { inReplyTo: text },
    { references: text },
    { subject: text },
    { normalizedSubject: text },
    { snippet: text },
    { textBody: text },
    { htmlBody: text },
    { folder: text },
    { sourceFolder: text },
    { sourceFolderPath: text },
    { sourceProviderName: text }
  ];
}

function sentSearchOr(value: string, text: { contains: string; mode: "insensitive" }) {
  const exact = value.trim().toLowerCase();
  return [
    { toEmails: { has: exact } },
    { ccEmails: { has: exact } },
    { bccEmails: { has: exact } },
    { subject: text },
    { bodyText: text },
    { bodyHtml: text },
    { body: text },
    { providerId: text },
    { sentFolder: text },
    { engagement: { is: { id: text } } },
    { proposalViews: { some: { OR: [{ proposalId: text }, { proposalUrl: text }, { engagementId: text }] } } }
  ];
}

function draftSearchOr(value: string, text: { contains: string; mode: "insensitive" }) {
  const exact = value.trim().toLowerCase();
  return [
    { toEmails: { has: exact } },
    { ccEmails: { has: exact } },
    { bccEmails: { has: exact } },
    { subject: text },
    { bodyText: text },
    { bodyHtml: text },
    { body: text },
    { basedOnMessageId: text },
    { basedOnMessageId: text }
  ];
}

function matchedIn(query: string, fields: Record<string, unknown>) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return Object.entries(fields)
    .filter(([, value]) => String(value || "").toLowerCase().includes(term))
    .map(([label]) => label)
    .slice(0, 4);
}

function rankResults<T extends { email: string; title: string; subject: string; date: Date | string | null }>(items: T[], normalizedQuery: string) {
  return items
    .map((item) => ({
      item,
      rank: [item.email, item.title].some((value) => value.toLowerCase() === normalizedQuery) ? 0 : item.email.toLowerCase().includes(normalizedQuery) ? 1 : 2
    }))
    .sort((a, b) => a.rank - b.rank || timeValue(b.item.date) - timeValue(a.item.date))
    .map(({ item }) => item)
    .slice(0, 5);
}

function timeValue(value: Date | string | null) {
  return value ? new Date(value).getTime() || 0 : 0;
}

function allEmailAddresses(item: { fromEmail: string; toEmails: string[]; ccEmails: string[]; bccEmails: string[] }) {
  return [item.fromEmail, ...item.toEmails, ...item.ccEmails, ...item.bccEmails].filter(Boolean);
}

function latestEmailAddress(item?: { fromEmail?: string | null; toEmails?: string[] | null } | null) {
  return item?.fromEmail || item?.toEmails?.[0] || "";
}

async function searchThreadIdsByEmailArrays(value: string, mailbox: { accountId: string | null; email: string }) {
  const term = `%${value.trim().toLowerCase()}%`;
  if (value.trim().length < 2) return [];
  const accountFilter = mailbox.accountId
    ? Prisma.sql`t."accountId" = ${mailbox.accountId}`
    : Prisma.sql`lower(a."emailAddress") = ${mailbox.email.toLowerCase()}`;
  try {
    const rows = await prisma.$queryRaw<Array<{ threadId: string }>>(Prisma.sql`
    SELECT DISTINCT e."threadId"
    FROM emails e
    JOIN email_threads t ON t.id = e."threadId"
    JOIN email_accounts a ON a.id = t."accountId"
    WHERE ${accountFilter}
      AND (
        lower(e."fromEmail") LIKE ${term}
        OR lower(coalesce(e."fromName", '')) LIKE ${term}
        OR EXISTS (SELECT 1 FROM unnest(e."toEmails") AS addr WHERE lower(addr) LIKE ${term})
        OR EXISTS (SELECT 1 FROM unnest(e."ccEmails") AS addr WHERE lower(addr) LIKE ${term})
        OR EXISTS (SELECT 1 FROM unnest(e."bccEmails") AS addr WHERE lower(addr) LIKE ${term})
      )
    UNION
    SELECT DISTINCT s."threadId"
    FROM sent_emails s
    JOIN email_threads t ON t.id = s."threadId"
    JOIN email_accounts a ON a.id = t."accountId"
    WHERE ${accountFilter}
      AND (
        EXISTS (SELECT 1 FROM unnest(s."toEmails") AS addr WHERE lower(addr) LIKE ${term})
        OR EXISTS (SELECT 1 FROM unnest(s."ccEmails") AS addr WHERE lower(addr) LIKE ${term})
        OR EXISTS (SELECT 1 FROM unnest(s."bccEmails") AS addr WHERE lower(addr) LIKE ${term})
      )
    UNION
    SELECT DISTINCT d."threadId"
    FROM drafts d
    JOIN email_threads t ON t.id = d."threadId"
    JOIN email_accounts a ON a.id = t."accountId"
    WHERE ${accountFilter}
      AND (
        EXISTS (SELECT 1 FROM unnest(d."toEmails") AS addr WHERE lower(addr) LIKE ${term})
        OR EXISTS (SELECT 1 FROM unnest(d."ccEmails") AS addr WHERE lower(addr) LIKE ${term})
        OR EXISTS (SELECT 1 FROM unnest(d."bccEmails") AS addr WHERE lower(addr) LIKE ${term})
      )
    `);
    return rows.map((row) => row.threadId);
  } catch {
    return [];
  }
}

function leadIntakeSearchOr(value: string) {
  const text = { contains: value, mode: "insensitive" as const };
  return [
    { extractedName: text },
    { extractedClientEmail: text },
    { subject: text },
    { extractedCompany: text },
    { extractedWebsite: text },
    { sourceProviderName: text },
    { detectedProviderName: text },
    { leadGeneratorEmail: text },
    { fromEmail: text },
    { sourceFolder: text },
    { sourceFolderPath: text },
    { extractedCountry: text },
    { extractedService: text },
    { rawText: text },
    { originalClientMessage: text },
    { forwardedClientMessage: text }
  ];
}
