import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmailAccountWizard } from "@/components/EmailAccountWizard";
import { requireUser } from "@/lib/auth";

export default async function NewEmailAccountPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  return (
    <AppShell>
      <div className="mb-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
          4-step setup
        </div>
        <h1 className="page-title">Add Email Account</h1>
        <p className="mt-1 text-sm text-muted">Create a mailbox, test connection, discover folders, and choose import behavior.</p>
      </div>
      <EmailAccountWizard />
    </AppShell>
  );
}
