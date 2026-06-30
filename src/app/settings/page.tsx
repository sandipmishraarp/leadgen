import { redirect } from "next/navigation";
import Link from "next/link";
import { Brain, DatabaseBackup, KeyRound, ListChecks, Shield, SlidersHorizontal, Users, Waypoints } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AutomationSettingsPanel } from "@/components/AutomationSettingsPanel";
import { TrackingSettingsPanel } from "@/components/TrackingSettingsPanel";
import { WhatsAppSettingsPanel } from "@/components/WhatsAppSettingsPanel";
import { requireUser } from "@/lib/auth";
import { getAutomationSettings } from "@/lib/services/safe-automation";
import { ensureTrackingSyncScheduler, getTrackingState, trackingGatewayApiKeyConfigured } from "@/lib/services/tracking-gateway";
import { getWhatsAppSettings, publicWhatsAppSettings } from "@/lib/services/whatsapp";

const settingsSections = [
  { title: "General", detail: "Workspace defaults, branding, timezone, and application behavior.", icon: SlidersHorizontal },
  { title: "AI", detail: "OpenAI model, prompts, knowledge base, and generation guardrails.", icon: Brain },
  { title: "Users", detail: "Admin login, team access, and user lifecycle.", icon: Users },
  { title: "Roles", detail: "Permission groups for sales, admin, support, and future teams.", icon: Shield },
  { title: "Tracking", detail: "Open tracking, link tracking, proposal views, and engagement settings.", icon: Waypoints },
  { title: "API", detail: "API keys, webhooks, integrations, and developer access.", icon: KeyRound },
  { title: "Backup", detail: "Database export, restore points, and data retention.", icon: DatabaseBackup },
  { title: "Logs", detail: "System logs, sync logs, AI logs, and operational events.", icon: ListChecks }
];

export default async function SettingsPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }
  ensureTrackingSyncScheduler();
  const [trackingState, automationSettings, whatsappSettings] = await Promise.all([
    getTrackingState(),
    getAutomationSettings(),
    getWhatsAppSettings()
  ]);

  return (
    <AppShell>
      <div className="mb-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
          System workspace
        </div>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-muted">Email configuration now lives in Email Accounts. This area is reserved for platform-level settings.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {settingsSections.map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.title} className="premium-card p-5">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-subtle text-accent">
                <Icon size={20} />
              </div>
              <h2 className="font-bold">{section.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{section.detail}</p>
              {section.title === "AI" ? (
                <Link href="/ai-usage" className="mt-4 block rounded-lg border border-line bg-subtle px-3 py-2 text-xs font-semibold text-accent hover:border-strong">
                  Open AI Usage Dashboard
                </Link>
              ) : section.title === "Tracking" ? (
                <div className="mt-4 rounded-lg border border-line bg-subtle px-3 py-2 text-xs font-semibold text-accent">
                  Gateway sync configured
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-line bg-subtle px-3 py-2 text-xs font-semibold text-muted">
                  Coming in platform settings
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="mt-6">
        <AutomationSettingsPanel settings={automationSettings} />
      </div>
      <div className="mt-6">
        <TrackingSettingsPanel state={trackingState} apiKeyConfigured={trackingGatewayApiKeyConfigured()} />
      </div>
      <div className="mt-6">
        <WhatsAppSettingsPanel settings={publicWhatsAppSettings(whatsappSettings)} />
      </div>
    </AppShell>
  );
}
