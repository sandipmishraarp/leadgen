import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReplyDraft } from "@/lib/services/openai";
import { getLeadContactBlock } from "@/lib/services/send-safety";

const schema = z.object({
  threadId: z.string().min(1),
  draftType: z.enum(["REPLY", "FOLLOWUP"]).default("REPLY")
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const thread = await prisma.emailThread.findUnique({
      where: { id: input.threadId },
      select: {
        leadId: true,
        messageCount: true,
        emails: { select: { id: true }, take: 1 },
        sentEmails: { select: { id: true }, take: 1 }
      }
    });
    if (thread?.leadId) {
      const block = await getLeadContactBlock(thread.leadId);
      if (block.blocked) {
        throw new Error(`Draft not generated because this lead is marked Do Not Contact: ${block.label.toLowerCase()}.`);
      }
    }
    const draft = await generateReplyDraft(input.threadId, input.draftType);
    const existingConversation = Boolean(
      (thread?.messageCount || 0) > 0
      || (thread?.emails?.length || 0) > 0
      || (thread?.sentEmails?.length || 0) > 0
    );
    return jsonOk({ draft, existingConversation });
  } catch (error) {
    return jsonError(error);
  }
}
