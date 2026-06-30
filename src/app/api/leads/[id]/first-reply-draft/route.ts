import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { generateFirstReplyDraft } from "@/lib/services/openai";
import { getLeadContactBlock } from "@/lib/services/send-safety";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const block = await getLeadContactBlock(params.id);
    if (block.blocked) {
      throw new Error(`Draft not generated because this lead is marked Do Not Contact: ${block.label.toLowerCase()}.`);
    }
    const draft = await generateFirstReplyDraft(params.id);
    return jsonOk({ draft });
  } catch (error) {
    return jsonError(error);
  }
}
