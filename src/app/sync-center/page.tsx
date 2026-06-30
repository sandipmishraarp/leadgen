import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SyncCenterDashboard } from "@/components/SyncCenterDashboard";
import { requireUser } from "@/lib/auth";
import { getSyncCenterSnapshot } from "@/lib/services/sync-center-reporting";

export default async function SyncCenterPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const snapshot = await getSyncCenterSnapshot();

  return (
    <AppShell>
      <SyncCenterDashboard initialSnapshot={snapshot} />
    </AppShell>
  );
}
