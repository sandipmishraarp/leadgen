import { Mail } from "lucide-react";

export function MailboxViewingBanner({ email, role }: { email: string; role: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-4 py-3 text-sm">
      <Mail size={16} className="text-accent" />
      <div>
        <span className="font-semibold">Viewing:</span> {email}
      </div>
      <div className="text-muted">
        <span className="font-semibold">Role:</span> {role}
      </div>
    </div>
  );
}
