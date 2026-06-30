import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { checkTrackingGatewayHealth } from "@/lib/services/tracking-gateway";

export async function POST() {
  try {
    await requireUser();
    const health = await checkTrackingGatewayHealth();
    return jsonOk({ health });
  } catch (error) {
    return jsonError(error);
  }
}
