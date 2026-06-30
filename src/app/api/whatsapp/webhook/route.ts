import { jsonError, jsonOk } from "@/lib/http";
import { getWhatsAppSettings, handleWhatsAppWebhook } from "@/lib/services/whatsapp";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const settings = await getWhatsAppSettings();
  if (mode === "subscribe" && token && token === settings.webhookVerifyToken) {
    return new Response(challenge || "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    await handleWhatsAppWebhook(payload);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
