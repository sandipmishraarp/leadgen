import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { appendSentEmailToImap } from "@/lib/services/imap-sent-append";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const result = await appendSentEmailToImap(params.id);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
