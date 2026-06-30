import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { syncAllActiveAccountsNow } from "@/lib/services/sync-engine";

export async function POST() {
  try {
    await requireUser();
    const result = await syncAllActiveAccountsNow({ trigger: "manual" });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
