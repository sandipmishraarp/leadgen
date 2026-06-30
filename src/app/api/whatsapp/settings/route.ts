import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { getWhatsAppSettings, publicWhatsAppSettings, saveWhatsAppSettings } from "@/lib/services/whatsapp";

export async function GET() {
  try {
    await requireUser();
    const settings = await getWhatsAppSettings();
    return jsonOk({ settings: publicWhatsAppSettings(settings) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireUser();
    const input = await request.json();
    const settings = await saveWhatsAppSettings(input);
    return jsonOk({ settings: publicWhatsAppSettings(settings) });
  } catch (error) {
    return jsonError(error);
  }
}
