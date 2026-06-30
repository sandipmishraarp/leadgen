import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientDateTime } from "@/components/ClientDateTime";
import { LeadIntakeTable } from "@/components/LeadIntakeTable";
import { MailboxViewingBanner } from "@/components/MailboxViewingBanner";
import { SyncButton } from "@/components/SyncButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isLeadIntakeMailbox, leadIntakeWhereForMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";
import { BulkLeadIntakeActions } from "@/components/LeadIntakeActions";
import { getLeadContactBlock } from "@/lib/services/send-safety";
import { groupLeadIntakeRows } from "@/lib/services/lead-intake-grouping";

const filters = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "needs-reply", label: "Needs Reply" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "hold", label: "Hold" },
  { key: "archived", label: "Archived" },
  { key: "latest", label: "Latest" },
  { key: "low-confidence", label: "Low Confidence" },
  { key: "manual-confirmation", label: "Manual Confirmation" },
  { key: "needs-sandip-acceptance", label: "Needs Sandip Acceptance" },
  { key: "today", label: "Today" },
  { key: "this-week", label: "This Week" },
  { key: "new-since-last-sync", label: "New Since Last Sync" },
  { key: "new-leads", label: "New Leads" },
  { key: "old-leads", label: "Old Leads" },
  { key: "dormant-leads", label: "Dormant Leads" },
  { key: "revival-leads", label: "Revival Leads" },
  { key: "safe-to-contact", label: "Safe to Contact" },
  { key: "do-not-contact", label: "Do Not Contact" },
  { key: "bounced", label: "Bounced" },
  { key: "unsubscribed", label: "Unsubscribed" },
  { key: "not-interested", label: "Not Interested" }
];

export default async function LeadIntakePage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const mailbox = await resolveMailboxContext(searchParams?.mailbox, "lead@aresourcepool.com");
  if (!isLeadIntakeMailbox(mailbox)) {
    return (
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Lead Intake</h1>
          <p className="text-sm text-slate-500">This workflow is restricted to Lead Intake accounts.</p>
        </div>
        <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />
        <section className="rounded-lg border border-line bg-white p-8 text-center">
          <h2 className="text-lg font-bold">This page is only available for Lead Intake accounts.</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
            The selected mailbox is a {mailbox.role} account, so raw lead approval records are hidden.
          </p>
          <Link href="/lead-intake?mailbox=lead%40aresourcepool.com" className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
            Switch to Lead Intake Account
          </Link>
        </section>
      </AppShell>
    );
  }
  const activeFilter = filters.some((item) => item.key === searchParams?.filter) ? searchParams?.filter || "waiting" : "waiting";
  const advancedOpen = searchParams?.advanced === "open";
  const activeChips = activeFilterChips(searchParams || {}, mailbox.email, activeFilter);
  const pageSize = parsePageSize(searchParams?.pageSize);
  const where = buildLeadIntakeWhere(mailbox, searchParams || {}, filterToStatus(activeFilter), filterToExtraWhere(activeFilter));
  const items = await prisma.leadIntake.findMany({
    where,
    orderBy: sortOrder(searchParams?.sort),
    take: pageSize * 4,
    select: leadIntakeListSelect()
  }) as any[];
  const blockEntries = await Promise.all(items.map(async (item) => [
    item.id,
    item.leadId ? await getLeadContactBlock(item.leadId) : null
  ] as const));
  const blocksByItemId = new Map(blockEntries);
  const visibleItems = items.filter((item) => {
    const block = blocksByItemId.get(item.id);
    if (activeFilter === "safe-to-contact") return !block?.blocked;
    if (activeFilter === "do-not-contact") return Boolean(block?.blocked);
    if (activeFilter === "bounced") return block?.code === "BOUNCED";
    if (activeFilter === "unsubscribed") return block?.code === "UNSUBSCRIBED";
    if (activeFilter === "not-interested") return block?.code === "NOT_INTERESTED";
    return true;
  });
  const tableItems = groupLeadIntakeRows(visibleItems).slice(0, pageSize).map(serializeLeadIntakeRow);
  const blockRows = Object.fromEntries(blockEntries);
  const statsBase = leadIntakeWhereForMailbox(mailbox);
  const todayStart = startOfDay(new Date());
  const account = mailbox.accountId ? await prisma.emailAccount.findUnique({ where: { id: mailbox.accountId }, select: { lastSyncedAt: true, connectionStatus: true } }) : null;
  const lastSyncStartedAt = getLastSyncStartedAt(account?.connectionStatus);
  const [total, waiting, approved, rejected, hold, today, newSinceLastSync] = await Promise.all([
    prisma.leadIntake.count({ where: statsBase }),
    prisma.leadIntake.count({ where: { AND: [statsBase, { status: { in: ["WAITING_FOR_SANDIP", "NEEDS_REPLY"] } }] } }),
    prisma.leadIntake.count({ where: { AND: [statsBase, { status: "APPROVED" }] } }),
    prisma.leadIntake.count({ where: { AND: [statsBase, { status: "REJECTED" }] } }),
    prisma.leadIntake.count({ where: { AND: [statsBase, { status: "HOLD" }] } }),
    prisma.leadIntake.count({ where: { AND: [statsBase, { receivedAt: { gte: todayStart } }] } }),
    prisma.leadIntake.count({ where: { AND: [statsBase, { importedAt: { gte: lastSyncStartedAt || daysAgo(1) } }] } })
  ]);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lead Intake</h1>
          <p className="text-sm text-slate-500">
            Leads forwarded to lead@aresourcepool.com. Sandip reviews and decides approve, reject, hold, or archive.
          </p>
        </div>
        <SyncButton mode="lead-intake-latest" accountEmail={mailbox.email} accountId={mailbox.accountId} />
      </div>
      <MailboxViewingBanner email={mailbox.email} role={mailbox.role} />

      <SyncStatusStrip account={account} />

      <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-7">
        <Stat label="Total" value={total} />
        <Stat label="Waiting" value={waiting} />
        <Stat label="Approved" value={approved} />
        <Stat label="Rejected" value={rejected} />
        <Stat label="Hold" value={hold} />
        <Stat label="Today" value={today} />
        <Stat label="New Since Last Sync" value={newSinceLastSync} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.key}
            href={`/lead-intake?mailbox=${encodeURIComponent(mailbox.email)}&filter=${filter.key}`}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              activeFilter === filter.key
                ? "border-accent bg-accent text-white"
                : "border-line bg-white text-slate-600 hover:border-accent hover:text-accent"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <div className="mb-4 rounded-lg border border-line bg-white p-3">
        <form className="flex flex-col gap-3 md:flex-row md:items-end">
          <input type="hidden" name="mailbox" value={mailbox.email} />
          <input type="hidden" name="filter" value={activeFilter} />
          <label className="block min-w-0 flex-1">
            <span className="text-xs font-medium text-slate-500">Search leads</span>
            <input
              name="q"
              defaultValue={searchParams?.q || ""}
              className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
              placeholder="Search email, subject, provider, website, body..."
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Page size</span>
            <select name="pageSize" defaultValue={String(pageSize)} className="mt-1 h-10 rounded-md border border-line bg-white px-3 text-sm">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button className="h-10 rounded-md bg-accent px-4 text-sm font-semibold text-white">Search</button>
          <Link
            href={withQuery(searchParams || {}, { mailbox: mailbox.email, filter: activeFilter, advanced: advancedOpen ? null : "open" })}
            className="inline-flex h-10 items-center justify-center rounded-md border border-line px-4 text-sm font-semibold text-slate-600"
          >
            Advanced Filters{activeChips.advancedCount ? ` (${activeChips.advancedCount})` : ""}
          </Link>
          {activeChips.items.length ? (
            <Link href={`/lead-intake?mailbox=${encodeURIComponent(mailbox.email)}&filter=waiting`} className="inline-flex h-10 items-center justify-center rounded-md border border-line px-4 text-sm font-semibold text-slate-600">
              Clear All
            </Link>
          ) : null}
        </form>
      </div>

      {advancedOpen ? (
      <div className="fixed inset-0 z-50 overflow-auto bg-slate-950/40 p-4 md:static md:z-auto md:mb-4 md:overflow-visible md:bg-transparent md:p-0">
      <form className="mx-auto max-w-5xl rounded-lg border border-line bg-white p-4 shadow-xl md:max-w-none md:shadow-none">
        <input type="hidden" name="mailbox" value={mailbox.email} />
        <input type="hidden" name="filter" value={activeFilter} />
        <div className="grid gap-3 md:grid-cols-4">
          <Input name="clientName" label="Client name" value={searchParams?.clientName} />
          <Input name="q" label="Search all lead fields" value={searchParams?.q} />
          <Input name="clientEmail" label="Client email" value={searchParams?.clientEmail} />
          <Input name="subject" label="Subject" value={searchParams?.subject} />
          <Input name="company" label="Company" value={searchParams?.company} />
          <Input name="websiteSearch" label="Website" value={searchParams?.websiteSearch} />
          <Input name="provider" label="Provider name" value={searchParams?.provider} />
          <Input name="providerEmail" label="Provider email" value={searchParams?.providerEmail} />
          <Input name="body" label="Email body keyword" value={searchParams?.body} />
          <Input name="sourceMailbox" label="Source mailbox" value={searchParams?.sourceMailbox} />
          <Input name="sourceFolder" label="Source folder" value={searchParams?.sourceFolder} />
          <Input name="country" label="Country" value={searchParams?.country} />
          <Input name="service" label="Service" value={searchParams?.service} />
          <Select name="date" label="Date" value={searchParams?.date} options={[["", "Any"], ["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 Days"], ["last30", "Last 30 Days"]]} />
          <Input name="receivedFrom" label="Received from" value={searchParams?.receivedFrom} type="date" />
          <Input name="receivedTo" label="Received to" value={searchParams?.receivedTo} type="date" />
          <Input name="importedFrom" label="Imported from" value={searchParams?.importedFrom} type="date" />
          <Input name="importedTo" label="Imported to" value={searchParams?.importedTo} type="date" />
          <Input name="confidenceMin" label="Confidence min" value={searchParams?.confidenceMin} type="number" />
          <Input name="confidenceMax" label="Confidence max" value={searchParams?.confidenceMax} type="number" />
          <Select name="websitePresence" label="Website quality" value={searchParams?.websitePresence} options={[["", "Any"], ["has", "Has website"], ["missing", "Missing website"]]} />
          <Select name="manualReview" label="Manual review" value={searchParams?.manualReview} options={[["", "Any"], ["true", "Needed"]]} />
          <Select name="sort" label="Sort" value={searchParams?.sort} options={[["latest", "Latest first"], ["oldest", "Oldest first"], ["highest-confidence", "Highest confidence"], ["lowest-confidence", "Lowest confidence"], ["client-name", "Client name A-Z"], ["provider", "Provider name"], ["country", "Country"]]} />
          <Select name="pageSize" label="Page size" value={String(pageSize)} options={[["25", "25"], ["50", "50"], ["100", "100"]]} />
        </div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Apply filters</button>
          <Link href={`/lead-intake?mailbox=${encodeURIComponent(mailbox.email)}&filter=waiting`} className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-600">
            Clear All
          </Link>
          <Link href={withQuery(searchParams || {}, { advanced: null })} className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-600">
            Close
          </Link>
        </div>
      </form>
      </div>
      ) : null}

      {activeChips.items.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeChips.items.map((chip) => (
            <Link key={chip.key} href={chip.href} className="rounded-full border border-line bg-white px-3 py-1 text-sm text-slate-600 hover:border-accent hover:text-accent">
              {chip.label} ×
            </Link>
          ))}
          <Link href={`/lead-intake?mailbox=${encodeURIComponent(mailbox.email)}&filter=waiting`} className="text-sm font-semibold text-accent">
            Clear All
          </Link>
        </div>
      ) : null}

      <BulkLeadIntakeActions />

      <LeadIntakeTable items={tableItems} blocksByItemId={blockRows} />
    </AppShell>
  );
}

function serializeLeadIntakeRow(item: any) {
  return {
    ...item,
    receivedAt: item.receivedAt?.toISOString?.() || item.receivedAt,
    importedAt: item.importedAt?.toISOString?.() || item.importedAt,
    updatedAt: item.updatedAt?.toISOString?.() || item.updatedAt
  };
}

function ParsedLeadPreview({ item }: { item: any }) {
  const conversationStatus = getConversationStatus(item);
  const approvalStatus = getApprovalStatus(item.status);
  const suggestedAction = getSuggestedAction(item);
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
          {conversationStatus}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${approvalStatusClass(approvalStatus)}`}>
          {approvalStatus}
        </span>
      </div>
      <Info label="Actual Client Name" value={item.originalClientName || item.extractedName} />
      <Info label="Actual Client Email" value={item.originalClientEmail || item.extractedClientEmail} />
      <Info label="Company" value={item.originalCompany || item.extractedCompany} />
      <Info label="Website" value={item.originalWebsite || item.extractedWebsite} />
      <Info label="Country" value={item.extractedCountry} />
      <Info label="Service" value={item.extractedService} />
      <Info label="Provider Sender" value={item.providerEmail || item.leadGeneratorEmail || item.fromEmail} />
      {item.originalSubject ? <Info label="Original Subject" value={item.originalSubject} /> : null}
      {item.detectedIntent ? <Info label="Intent" value={item.detectedIntent.replaceAll("_", " ")} /> : null}
      <div className="mt-2 rounded-md border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-700">
        <span className="font-semibold text-slate-900">Suggested Action: </span>
        {suggestedAction}
      </div>
      <a href={`#raw-forward-${item.id}`} className="mt-2 inline-flex text-xs font-semibold text-accent">
        View Raw Forward
      </a>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="mb-1">
      <span className="text-xs text-slate-500">{label}: </span>
      <span>{value || "Not found"}</span>
    </div>
  );
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
    extractedCountry: true,
    extractedService: true,
    extractedCompany: true,
    originalClientName: true,
    originalClientEmail: true,
    originalWebsite: true,
    originalCompany: true,
    detectedIntent: true,
    leadSourceType: true,
    conversationType: true,
    replyMode: true,
    forwardedBy: true,
    providerEmail: true,
    sourceFolder: true,
    sourceFolderPath: true,
    sourceProviderName: true,
    detectedProviderName: true,
    extractionConfidence: true,
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

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return [25, 50, 100].includes(parsed) ? parsed : 25;
}

function getConversationStatus(item: any) {
  if (item.replyMode === "continue_existing_conversation" || item.conversationType === "warm_reply") return "Warm Reply";
  if (item.extractedClientEmail || item.originalClientEmail) return "Fresh Lead";
  return "Unknown";
}

function getApprovalStatus(status: string) {
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Not Approved";
  return "Pending";
}

function approvalStatusClass(status: string) {
  if (status === "Approved") return "bg-emerald-100 text-emerald-700";
  if (status === "Not Approved") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

function getSuggestedAction(item: any) {
  if (item.replyMode === "continue_existing_conversation" || item.conversationType === "warm_reply") {
    return "Generate a context reply as Abhay and continue the client conversation. Do not include provider metadata.";
  }
  if (item.needsManualConfirmation) return "Confirm the actual client email before assignment or draft generation.";
  if (item.status === "REJECTED") return "Not approved for normal assignment. Admin can still continue manually if needed.";
  return "Review, approve, assign to sales, or generate a first reply draft.";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function SyncStatusStrip({ account }: { account: any }) {
  const status = account?.connectionStatus && typeof account.connectionStatus === "object" && !Array.isArray(account.connectionStatus)
    ? account.connectionStatus as Record<string, any>
    : {};
  return (
    <section className="mb-4 rounded-lg border border-line bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-semibold">Sync Status: {status.lastSyncStatus || "Idle"}</span>
        <span className="text-slate-500">Last sync: <ClientDateTime value={account?.lastSyncedAt} fallback="Never" timeStyle="short" /></span>
        <span className="text-slate-500">Mode: {status.lastSyncMode || "n/a"}</span>
        <span className="text-slate-500">New: {status.lastSyncImported ?? 0}</span>
        <span className="text-slate-500">Skipped: {status.lastSyncSkipped ?? 0}</span>
        <span className="text-slate-500">Needs review: {status.lastSyncNeedsReview ?? 0}</span>
        {status.error ? <span className="text-red-700">Error: {String(status.error)}</span> : null}
      </div>
    </section>
  );
}

function Input({ name, label, value, type = "text" }: { name: string; label: string; value?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input name={name} defaultValue={value || ""} type={type} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm" />
    </label>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select name={name} defaultValue={value || ""} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm">
        {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
}

function withQuery(current: Record<string, string | undefined>, updates: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  return `/lead-intake?${params.toString()}`;
}

function activeFilterChips(params: Record<string, string | undefined>, mailbox: string, activeFilter: string) {
  const labels: Record<string, string> = {
    q: "Search",
    clientName: "Name",
    clientEmail: "Email",
    subject: "Subject",
    company: "Company",
    websiteSearch: "Website",
    provider: "Provider",
    providerEmail: "Provider email",
    body: "Body",
    sourceMailbox: "Source mailbox",
    sourceFolder: "Source folder",
    country: "Country",
    service: "Service",
    receivedFrom: "Received from",
    receivedTo: "Received to",
    importedFrom: "Imported from",
    importedTo: "Imported to",
    confidenceMin: "Min confidence",
    confidenceMax: "Max confidence"
  };
  const valueLabels: Record<string, Record<string, string>> = {
    date: { today: "Today", yesterday: "Yesterday", last7: "Last 7 Days", last30: "Last 30 Days" },
    websitePresence: { has: "Has website", missing: "Missing website" },
    manualReview: { true: "Manual review needed" },
    sort: {
      oldest: "Oldest first",
      "highest-confidence": "Highest confidence",
      "lowest-confidence": "Lowest confidence",
      "client-name": "Client name A-Z",
      provider: "Provider name",
      country: "Country"
    }
  };
  const chipKeys = [...Object.keys(labels), ...Object.keys(valueLabels)];
  const items = chipKeys.flatMap((key) => {
    const value = params[key];
    if (!value || (key === "sort" && value === "latest")) return [];
    const label = valueLabels[key]?.[value] || `${labels[key] || key}: ${value}`;
    return [{
      key,
      label,
      href: withQuery(params, { mailbox, filter: activeFilter, [key]: null, advanced: null })
    }];
  });
  return {
    items,
    advancedCount: items.filter((item) => item.key !== "q").length
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
  if (filter === "waiting") return { status: { in: ["WAITING_FOR_SANDIP", "NEEDS_REPLY"] } };
  if (filter === "latest") return { status: { in: ["WAITING_FOR_SANDIP", "NEEDS_REPLY"] } };
  if (filter === "today") return { receivedAt: { gte: startOfDay(new Date()) } };
  if (filter === "this-week") return { receivedAt: { gte: daysAgo(7) } };
  if (filter === "new-since-last-sync") return { importedAt: { gte: daysAgo(1) } };
  if (filter === "new-leads") return { receivedAt: { gte: daysAgo(30) } };
  if (filter === "old-leads") return { receivedAt: { gte: daysAgo(180), lt: daysAgo(30) } };
  if (filter === "dormant-leads") return { receivedAt: { gte: daysAgo(730), lt: daysAgo(180) } };
  if (filter === "revival-leads") return { receivedAt: { lt: daysAgo(730) } };
  return undefined;
}

function buildLeadIntakeWhere(mailbox: any, params: Record<string, string | undefined>, status?: string, extraWhere?: Record<string, unknown>) {
  const parts: any[] = [leadIntakeWhereForMailbox(mailbox, status, extraWhere)];
  const q = params.q?.trim();
  if (q) parts.push({ OR: leadIntakeSearchOr(q) });
  const fields = [
    ["clientName", "extractedName"], ["clientEmail", "extractedClientEmail"], ["subject", "subject"],
    ["company", "extractedCompany"], ["providerEmail", "leadGeneratorEmail"], ["body", "rawText"],
    ["sourceMailbox", "accountEmail"], ["sourceFolder", "sourceFolderPath"], ["country", "extractedCountry"], ["service", "extractedService"]
  ] as const;
  for (const [param, field] of fields) {
    const value = params[param]?.trim();
    if (value) parts.push({ [field]: { contains: value, mode: "insensitive" } });
  }
  if (params.websiteSearch) parts.push({ extractedWebsite: { contains: params.websiteSearch, mode: "insensitive" } });
  if (params.provider) parts.push({ OR: [{ sourceProviderName: { contains: params.provider, mode: "insensitive" } }, { detectedProviderName: { contains: params.provider, mode: "insensitive" } }] });
  const min = params.confidenceMin?.trim() ? Number(params.confidenceMin) : NaN;
  const max = params.confidenceMax?.trim() ? Number(params.confidenceMax) : NaN;
  if (!Number.isNaN(min)) parts.push({ extractionConfidence: { gte: min } });
  if (!Number.isNaN(max)) parts.push({ extractionConfidence: { lte: max } });
  if (params.websitePresence === "has") parts.push({ extractedWebsite: { not: null } });
  if (params.websitePresence === "missing") parts.push({ OR: [{ extractedWebsite: null }, { extractedWebsite: "" }] });
  if (params.manualReview === "true") parts.push({ needsManualConfirmation: true });
  if (params.date === "today") parts.push({ receivedAt: { gte: startOfDay(new Date()) } });
  if (params.date === "yesterday") {
    const start = startOfDay(daysAgo(1));
    parts.push({ receivedAt: { gte: start, lt: startOfDay(new Date()) } });
  }
  if (params.date === "last7") parts.push({ receivedAt: { gte: daysAgo(7) } });
  if (params.date === "last30") parts.push({ receivedAt: { gte: daysAgo(30) } });
  const receivedRange = dateRange(params.receivedFrom, params.receivedTo);
  if (receivedRange) parts.push({ receivedAt: receivedRange });
  const importedRange = dateRange(params.importedFrom, params.importedTo);
  if (importedRange) parts.push({ importedAt: importedRange });
  return { AND: parts };
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
    "forwardedClientMessage",
    "latestClientMessage",
    "originalClientEmail",
    "originalClientName",
    "originalSubject",
    "providerEmail",
    "detectedIntent"
  ].map((field) => ({ [field]: { contains: value, mode: "insensitive" } }));
}

function sortOrder(sort?: string) {
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

function dateRange(from?: string, to?: string) {
  const range: Record<string, Date> = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return Object.keys(range).length ? range : null;
}

function leadAgeClassification(value: string | Date) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 30) return "NEW_LEAD";
  if (days <= 180) return "OLD_LEAD";
  if (days <= 730) return "DORMANT_LEAD";
  return "REVIVAL_LEAD";
}

function formatLeadAge(value: string | Date) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round((days / 365) * 10) / 10} years`;
}
