import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AiUsageSettingsForm } from "@/components/AiUsageSettingsForm";
import { ClientDateTime } from "@/components/ClientDateTime";
import { requireUser } from "@/lib/auth";
import { getAiUsageSummary } from "@/lib/services/ai-usage";

export default async function AiUsagePage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const summary = await getAiUsageSummary();
  const cards = [
    ["AI calls today", String(summary.totalCallsToday)],
    ["Tokens used today", summary.tokensToday.toLocaleString("en-US")],
    ["Estimated cost", `$${summary.costToday.toFixed(4)}`],
    ["Avg tokens/request", summary.averageTokensPerRequest.toLocaleString("en-US")],
    ["Cache hits today", String(summary.cacheHitsToday)]
  ];

  return (
    <AppShell>
      <div className="mb-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
          Token optimization
        </div>
        <h1 className="page-title">AI Usage Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Track AI calls, token usage, cost, cache hits, and daily limits.</p>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-5">
        {cards.map(([label, value]) => (
          <section key={label} className="premium-card p-5">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
          </section>
        ))}
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <section className="premium-card overflow-hidden">
          <div className="border-b border-line p-5">
            <h2 className="font-bold">Cost by Feature</h2>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Feature</th>
                  <th className="px-4 py-3">Calls</th>
                  <th className="px-4 py-3">Tokens</th>
                  <th className="px-4 py-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byFeature.length ? summary.byFeature.map((row) => (
                  <tr key={row.feature} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold">{featureLabel(row.feature)}</td>
                    <td className="px-4 py-3">{row.calls}</td>
                    <td className="px-4 py-3">{row.tokens.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3">${row.cost.toFixed(4)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No AI usage logged today.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <AiUsageSettingsForm settings={summary.settings} />
      </div>

      <section className="premium-card overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="font-bold">Recent AI Calls</h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Feature</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Tokens</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">Cache</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent.length ? summary.recent.map((log) => (
                <tr key={log.id} className="border-t border-line">
                  <td className="px-4 py-3"><ClientDateTime value={log.createdAt} timeStyle="short" /></td>
                  <td className="px-4 py-3 font-semibold">{featureLabel(log.feature)}</td>
                  <td className="px-4 py-3">{log.model}</td>
                  <td className="px-4 py-3">{log.totalTokens.toLocaleString("en-US")}</td>
                  <td className="px-4 py-3">${log.estimatedCost.toFixed(4)}</td>
                  <td className="px-4 py-3">{log.latencyMs ? `${log.latencyMs} ms` : "--"}</td>
                  <td className="px-4 py-3">{log.cacheHit ? "Hit" : "New"}</td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No recent AI calls.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function featureLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
