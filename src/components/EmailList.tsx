import Link from "next/link";
import type { EmailDirection, LeadStatus } from "@prisma/client";
import { ClientDateTime } from "@/components/ClientDateTime";

type EmailRow = {
  id: string;
  threadId: string;
  direction: EmailDirection;
  folder: string;
  subject: string;
  snippet: string | null;
  fromEmail: string;
  toEmails: string[];
  sentAt: Date;
  thread: {
    lead: { email: string; name: string | null; status: LeadStatus; waitingForReply: boolean } | null;
  };
};

export function EmailList({ emails, basePath = "/emails" }: { emails: EmailRow[]; basePath?: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="grid grid-cols-[110px_1fr_180px_130px] border-b border-line bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-600">
        <span>Folder</span>
        <span>Email</span>
        <span>Lead</span>
        <span>Date</span>
      </div>
      <div className="divide-y divide-line">
        {emails.map((email) => (
          <Link
            key={email.id}
            href={`/inbox/${email.threadId}`}
            className="grid grid-cols-[110px_1fr_180px_130px] gap-4 px-5 py-4 hover:bg-slate-50"
          >
            <div>
              <div className="text-sm font-semibold">{email.direction === "INBOUND" ? "Inbox" : "Sent"}</div>
              <div className="text-xs text-slate-500">{email.folder}</div>
            </div>
            <div>
              <div className="font-semibold">{email.subject}</div>
              <div className="mt-1 text-sm text-slate-500">{email.snippet || email.fromEmail}</div>
              <div className="mt-1 text-xs text-slate-500">
                {email.direction === "INBOUND" ? `From ${email.fromEmail}` : `To ${email.toEmails.join(", ")}`}
              </div>
            </div>
            <div className="text-sm">
              <div className="font-medium">{email.thread.lead?.name || email.thread.lead?.email || "Unlinked"}</div>
              <div className="mt-1 text-xs text-slate-500">
                {email.thread.lead?.waitingForReply ? "Waiting for reply" : email.thread.lead?.status.replaceAll("_", " ")}
              </div>
            </div>
            <div className="text-sm text-slate-500"><ClientDateTime value={email.sentAt} /></div>
          </Link>
        ))}
        {!emails.length ? <div className="px-5 py-8 text-sm text-slate-500">No emails found for this view.</div> : null}
      </div>
      {emails.length ? (
        <div className="border-t border-line px-5 py-3 text-sm text-slate-500">
          Showing {emails.length}. Use the sync limit selector to import more emails.
        </div>
      ) : null}
    </section>
  );
}

export function FilterTabs({ active, mailbox }: { active: string; mailbox?: string }) {
  const tabs = [
    ["all", "All"],
    ["inbox", "Inbox"],
    ["sent", "Sent"],
    ["needs-follow-up", "Needs Follow-up"],
    ["replied", "Replied"],
    ["no-reply", "No Reply"],
    ["draft-created", "Draft Created"]
  ];
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {tabs.map(([key, label]) => (
        <Link
          key={key}
          href={buildFilterHref(key, mailbox)}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            active === key ? "border-accent bg-accent text-white" : "border-line bg-white text-slate-700"
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

function buildFilterHref(key: string, mailbox?: string) {
  const params = new URLSearchParams();
  if (key !== "all") params.set("filter", key);
  if (mailbox) params.set("mailbox", mailbox);
  const query = params.toString();
  return query ? `/emails?${query}` : "/emails";
}
