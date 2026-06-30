import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { sendWhatsAppMessage } from "@/lib/services/whatsapp";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const message = await sendWhatsAppMessage(params.id, user.email);
    return jsonOk({ message });
  } catch (error) {
    return jsonError(error);
  }
}
