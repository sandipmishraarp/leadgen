import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { publicWhatsAppSettings, testWhatsAppConnection } from "@/lib/services/whatsapp";

export async function POST() {
  try {
    await requireUser();
    const result = await testWhatsAppConnection();
    return jsonOk({ settings: publicWhatsAppSettings(result.account), meta: result.meta });
  } catch (error) {
    return jsonError(error);
  }
}
