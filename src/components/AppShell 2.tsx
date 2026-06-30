import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/lead-intake", label: "Lead Intake" },
  { href: "/lead-import", label: "Lead Import" },
  { href: "/emails", label: "All Emails" },
  { href: "/inbox", label: "Inbox" },
  { href: "/sent", label: "Sent" },
  { href: "/followups", label: "Follow-ups" },
  { href: "/drafts", label: "Drafts" },
  { href: "/scheduled", label: "Scheduled Emails" },
  { href: "/leads", label: "Leads" },
  { href: "/settings", label: "Settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white p-5 md:block">
        <div className="mb-8">
          <div className="text-lg font-bold">AResourcePool</div>
          <div className="text-sm text-slate-500">AI Sales Email Agent</div>
        </div>
        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-5 left-5 right-5">
          <LogoutButton />
        </div>
      </aside>
      <main className="md:pl-64">
        <div className="border-b border-line bg-white px-5 py-4 md:hidden">
          <div className="font-bold">AResourcePool</div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md border border-line px-3 py-1">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-5 py-6">{children}</div>
      </main>
    </div>
  );
}
