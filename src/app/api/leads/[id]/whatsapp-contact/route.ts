import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { upsertWhatsAppContact } from "@/lib/services/whatsapp";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = await request.json();
    return jsonOk(await upsertWhatsAppContact(params.id, input));
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = PATCH;
