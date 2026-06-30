import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { sendScheduledEmailNow } from "@/lib/services/scheduled-email";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const result = await sendScheduledEmailNow(params.id);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
