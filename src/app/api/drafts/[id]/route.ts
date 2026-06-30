import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";

const schema = z.object({
  toEmails: z.array(z.string().email()).optional(),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  attachmentMetadata: z.array(z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    type: z.string()
  })).optional(),
  trackingEnabled: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const previous = await prisma.draft.findUnique({ where: { id: params.id } });
    if (!previous) {
      return jsonOk({ error: "Draft not found" }, { status: 404 });
    }
    const draft = await prisma.$transaction(async (tx) => {
      const updated = await tx.draft.update({
        where: { id: params.id },
        data: {
          toEmails: input.toEmails,
          ccEmails: input.ccEmails,
          bccEmails: input.bccEmails,
          subject: input.subject,
          body: input.body,
          bodyHtml: input.bodyHtml,
          bodyText: input.bodyText || input.body,
          attachmentMetadata: input.attachmentMetadata,
          trackingEnabled: input.trackingEnabled
        }
      });
      if (previous.subject !== input.subject || previous.body !== input.body) {
        await tx.draftEdit.create({
          data: {
            draftId: previous.id,
            beforeSubject: previous.subject,
            afterSubject: input.subject,
            beforeBody: previous.body,
            afterBody: input.body,
            editSummary: summarizeEdit(previous.body, input.body)
          }
        });
      }
      return updated;
    });
    await logActivity({
      type: "DRAFT_UPDATED",
      message: "Draft edited",
      threadId: draft.threadId,
      metadata: { draftId: draft.id }
    });
    return jsonOk({ draft });
  } catch (error) {
    return jsonError(error);
  }
}

function summarizeEdit(before: string, after: string) {
  const beforeLength = before.length;
  const afterLength = after.length;
  if (afterLength < beforeLength * 0.75) return "User shortened the draft.";
  if (afterLength > beforeLength * 1.25) return "User added more detail to the draft.";
  return "User refined wording while keeping similar length.";
}
