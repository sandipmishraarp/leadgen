import { runDueAutoSyncOnce } from "@/lib/services/sync-engine";
import { runSafeAutomationOnce } from "@/lib/services/safe-automation";

const globalForScheduler = globalThis as typeof globalThis & {
  __aiSalesSchedulerStarted?: boolean;
};

export function startScheduledEmailWorker() {
  if (globalForScheduler.__aiSalesSchedulerStarted) return;
  globalForScheduler.__aiSalesSchedulerStarted = true;

  setInterval(() => {
    runDueAutoSyncOnce()
      .then(() => runSafeAutomationOnce())
      .catch((error) => {
        console.error("Automation worker failed", error);
      });
  }, 60 * 1000);
}
