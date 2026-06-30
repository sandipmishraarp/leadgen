import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { syncTrackingGateway } from "@/lib/services/tracking-gateway";

export async function POST() {
  try {
    await requireUser();
    const result = await syncTrackingGateway();
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
