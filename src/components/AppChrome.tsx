"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Activity,
  CalendarClock,
  Archive,
  CheckCircle2,
  Command,
  FileText,
  FolderTree,
  Inbox,
  LayoutDashboard,
  Mail,
  Moon,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Users,
  Workflow,
  X,
  XCircle
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import { isLeadMailbox, MailboxContextBadge, MailboxContextSwitcher, useMailboxContext } from "@/components/MailboxContextSwitcher";

const baseNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" }
];

const globalNav = [
  { href: "/email-accounts", label: "Email Accounts", icon: Mail, shortcut: "G A" },
  { href: "/sync-center", label: "Sync Center", icon: Activity, shortcut: "G Z" },
  { href: "/settings", label: "Settings", icon: Settings, shortcut: "G T" }
];

const leadMailboxNav = [
  { href: "/lead-intake", label: "Lead Intake", icon: Workflow, shortcut: "G I" },
  { href: "/lead-import", label: "Provider Folders", icon: FolderTree, shortcut: "G M" },
  { href: "/lead-import", label: "Lead Import", icon: FileText, shortcut: "G O" },
  { href: "/leads?status=WAITING_FOR_SANDIP", label: "Waiting", icon: Inbox, shortcut: "G W" },
  { href: "/leads?status=APPROVED", label: "Approved", icon: CheckCircle2, shortcut: "G P" },
  { href: "/leads?status=REJECTED", label: "Rejected", icon: XCircle, shortcut: "G X" },
  { href: "/leads?status=ARCHIVED", label: "Archive", icon: Archive, shortcut: "G V" }
];

const salesMailboxNav = [
  { href: "/leads", label: "Assigned Leads", icon: Users, shortcut: "G L" },
  { href: "/emails", label: "Client Conversations", icon: Mail, shortcut: "G E" },
  { href: "/inbox", label: "Inbox", icon: Inbox, shortcut: "G B" },
  { href: "/sent", label: "Sent", icon: Send, shortcut: "G S" },
  { href: "/drafts", label: "Drafts", icon: FileText, shortcut: "G R" },
  { href: "/scheduled", label: "Scheduled", icon: CalendarClock, shortcut: "G C" },
  { href: "/followups", label: "Follow-ups", icon: Sparkles, shortcut: "G F" },
  { href: "/drafts", label: "Templates", icon: FileText, shortcut: "G Y" }
];

const fallbackNotifications = [
  "Follow-ups due today are ready for review.",
  "Scheduled email worker is active.",
  "Tip: Press Cmd/Ctrl + K for commands."
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const mailbox = useMailboxContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<string[]>(fallbackNotifications);
  const [query, setQuery] = useState("");
  const [topSearch, setTopSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchGroups, setSearchGroups] = useState<Record<string, SearchResult[]>>({});
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("theme") as "light" | "dark" | null;
    const next = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setNotificationsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    fetch("/api/notifications")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const items = Array.isArray(data?.notifications)
          ? data.notifications.map((item: { message?: string }) => item.message).filter(Boolean)
          : [];
        if (items.length) setNotifications(items);
      })
      .catch(() => undefined);
  }, []);

  const nav = useMemo(() => {
    const contextualNav = isLeadMailbox(mailbox.activeAccount) ? leadMailboxNav : salesMailboxNav;
    return [...baseNav, ...contextualNav, ...globalNav];
  }, [mailbox.activeAccount]);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return nav;
    return nav.filter((item) => item.label.toLowerCase().includes(term) || item.href.includes(term));
  }, [nav, query]);

  useEffect(() => {
    const term = topSearch.trim();
    if (term.length < 2) {
      setSearchGroups({});
      return;
    }
    const handle = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: term });
      if (mailbox.activeAccount?.emailAddress) params.set("mailbox", mailbox.activeAccount.emailAddress);
      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json().catch(() => null);
      setSearchGroups(data?.groups || {});
      setSearchOpen(true);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [topSearch, mailbox.activeAccount?.emailAddress]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("theme", next);
  }

  function isActiveHref(href: string) {
    const [path, query = ""] = href.split("?");
    if (pathname !== path) return false;
    const expected = new URLSearchParams(query);
    for (const [key, value] of expected.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    if (!query) return true;
    return true;
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-line bg-surface/90 shadow-soft backdrop-blur-xl lg:block">
        <div className="flex h-full min-h-0 flex-col p-4">
          <Link href="/dashboard" className="mb-5 flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-glow">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight">AResourcePool</div>
              <div className="text-xs text-muted">AI Sales Email Agent</div>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="mb-4 flex h-11 w-full shrink-0 items-center gap-3 rounded-xl border border-line bg-elevated px-3 text-left text-sm text-muted shadow-sm transition hover:border-strong hover:text-ink"
          >
            <Search size={16} />
            <span className="flex-1">Search or jump to...</span>
            <kbd className="rounded-md border border-line bg-subtle px-1.5 py-0.5 text-[11px]">⌘K</kbd>
          </button>

          <div className="mb-4 shrink-0">
            <MailboxContextBadge account={mailbox.activeAccount} />
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const href = contextualHref(item.href, mailbox.activeAccount);
            const active = isActiveHref(item.href);
            return (
              <Link
                key={`${item.href}:${item.label}`}
                href={href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-accent text-white shadow-glow" : "text-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                <Icon size={17} className={`transition ${active ? "text-white" : "text-muted group-hover:text-accent"}`} />
                <span className="flex-1">{item.label}</span>
                <span className={`text-[10px] ${active ? "text-white/70" : "text-faint"}`}>{item.shortcut}</span>
              </Link>
            );
          })}
          </nav>

          <div className="mt-4 shrink-0 border-t border-line pt-4">
          <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-line bg-app/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <div className="relative min-w-0 flex-1">
            <div className="flex h-10 items-center gap-3 rounded-xl border border-line bg-surface px-3 text-sm text-muted shadow-sm transition focus-within:border-strong">
              <Search size={16} />
              <input
                value={topSearch}
                onChange={(event) => {
                  setTopSearch(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search leads, emails, drafts..."
                className="min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-muted"
              />
              <kbd className="hidden rounded-md border border-line bg-subtle px-1.5 py-0.5 text-[11px] sm:block">⌘K</kbd>
            </div>
            {searchOpen && topSearch.trim().length >= 2 ? (
              <GlobalSearchDropdown
                groups={searchGroups}
                query={topSearch}
                mailboxEmail={mailbox.activeAccount?.emailAddress}
                onClose={() => setSearchOpen(false)}
              />
            ) : null}
            </div>
            <MailboxContextSwitcher
              accounts={mailbox.accounts}
              activeAccount={mailbox.activeAccount}
              selectedId={mailbox.selectedId}
              onSelect={mailbox.selectMailbox}
            />
            <button type="button" onClick={toggleTheme} className="icon-button" aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen((value) => !value)} className="icon-button" aria-label="Notifications">
                <Bell size={17} />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" />
              </button>
              {notificationsOpen ? (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
                  <div className="border-b border-line px-4 py-3 text-sm font-bold">Notifications</div>
                  {notifications.map((item) => (
                    <div key={item} className="border-b border-line px-4 py-3 text-sm text-muted last:border-b-0">{item}</div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>

      {commandOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/40 p-4 backdrop-blur-sm" onMouseDown={() => setCommandOpen(false)}>
          <div className="mx-auto mt-20 max-w-2xl overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Command size={18} className="text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setTopSearch(event.target.value);
                }}
                placeholder="Search pages or run a command..."
                className="h-10 flex-1 border-0 bg-transparent outline-none"
              />
              <button type="button" onClick={() => setCommandOpen(false)} className="icon-button">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-96 overflow-auto p-2">
              {query.trim().length >= 2 && Object.values(searchGroups).some((group) => group.length) ? (
                <div className="space-y-2">
                  <GroupedSearchResults groups={searchGroups} query={query} onClose={() => setCommandOpen(false)} />
                </div>
              ) : results.map((item) => {
                const Icon = item.icon;
                const href = contextualHref(item.href, mailbox.activeAccount);
                return (
                  <Link key={`${item.href}:${item.label}`} href={href} onClick={() => setCommandOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-subtle">
                    <Icon size={17} className="text-accent" />
                    <span className="flex-1 font-medium">{item.label}</span>
                    <span className="text-xs text-muted">{item.shortcut}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SearchResult = {
  type: string;
  title: string;
  email: string;
  subject: string;
  status: string;
  date: string | null;
  href: string;
  matchedIn?: string[];
};

function GlobalSearchDropdown({
  groups,
  query,
  mailboxEmail,
  onClose
}: {
  groups: Record<string, SearchResult[]>;
  query: string;
  mailboxEmail?: string;
  onClose: () => void;
}) {
  const hasResults = Object.values(groups).some((group) => group.length);
  return (
    <div className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
      <div className="max-h-96 overflow-auto p-2">
        {hasResults ? <GroupedSearchResults groups={groups} query={query} onClose={onClose} /> : <div className="px-3 py-4 text-sm text-muted">No results found.</div>}
      </div>
      <Link
        href={`/lead-intake?q=${encodeURIComponent(query)}${mailboxEmail ? `&mailbox=${encodeURIComponent(mailboxEmail)}` : ""}`}
        onClick={onClose}
        className="block border-t border-line px-4 py-3 text-sm font-semibold text-accent"
      >
        View all results
      </Link>
    </div>
  );
}

function GroupedSearchResults({ groups, query, onClose }: { groups: Record<string, SearchResult[]>; query: string; onClose: () => void }) {
  const labels: Record<string, string> = {
    leads: "Leads",
    leadIntake: "Lead Intake",
    threads: "Threads",
    emails: "Emails",
    sent: "Sent Emails",
    drafts: "Drafts",
    followups: "Follow-ups",
    scheduled: "Scheduled",
    tracking: "Tracking",
    whatsapp: "WhatsApp"
  };
  return (
    <>
      {Object.entries(labels).map(([key, label]) => {
        const items = groups[key] || [];
        if (!items.length) return null;
        return (
          <div key={key} className="mb-2 last:mb-0">
            <div className="px-3 py-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
            {items.slice(0, 5).map((item, index) => (
              <Link key={`${key}-${item.href}-${index}`} href={item.href} onClick={onClose} className="block rounded-xl px-3 py-2 text-sm hover:bg-subtle">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold"><Highlight value={item.title} query={query} /></span>
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">{item.status}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted"><Highlight value={item.email || item.subject} query={query} /></div>
                {item.subject ? <div className="mt-0.5 truncate text-xs text-faint"><Highlight value={item.subject} query={query} /></div> : null}
                {item.matchedIn?.length ? <div className="mt-1 text-[11px] font-semibold text-accent">Matched in: {item.matchedIn.join(", ")}</div> : null}
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Highlight({ value, query }: { value: string; query: string }) {
  const text = String(value || "");
  const term = query.trim();
  if (!term) return <>{text}</>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-amber-100 px-0.5 text-ink">{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  );
}

function contextualHref(href: string, account: ReturnType<typeof useMailboxContext>["activeAccount"]) {
  if (!account) return href;
  const contextualPaths = ["/lead-intake", "/lead-import", "/emails", "/inbox", "/sent", "/drafts", "/scheduled", "/followups", "/leads"];
  const [path, query = ""] = href.split("?");
  if (!contextualPaths.includes(path)) return href;
  const params = new URLSearchParams(query);
  params.set("mailbox", account.emailAddress);
  return `${path}?${params.toString()}`;
}
