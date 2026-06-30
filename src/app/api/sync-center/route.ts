import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { getSyncCenterSnapshot } from "@/lib/services/sync-center-reporting";

export async function GET() {
  try {
    await requireUser();
    return jsonOk(await getSyncCenterSnapshot());
  } catch (error) {
    return jsonError(error);
  }
}
