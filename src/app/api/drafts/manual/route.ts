import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { getLeadContactBlock } from "@/lib/services/send-safety";

const schema = z.object({
  threadId: z.string().min(1)
});

const signatureText = "Best regards,\nAbhay Kumar\nSales & Marketing Director\nAResourcePool";
const signatureHtml = "<p>Best regards,<br><strong>Abhay Kumar</strong><br>Sales &amp; Marketing Director<br>AResourcePool</p>";

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const thread = await prisma.emailThread.findUnique({
      where: { id: input.threadId },
      include: {
        lead: true,
        emails: { orderBy: { sentAt: "asc" } }
      }
    });
    if (!thread) throw new Error("Thread not found.");
    if (!thread.lead) throw new Error("Thread has no linked lead.");
    const block = await getLeadContactBlock(thread.lead.id);
    if (block.blocked) throw new Error(`Manual reply blocked because this lead is marked Do Not Contact: ${block.label.toLowerCase()}.`);

    const latestInbound = [...thread.emails].reverse().find((email) => email.direction === "INBOUND");
    const subject = thread.subject.toLowerCase().startsWith("re:") ? thread.subject : `Re: ${thread.subject}`;
    const toEmails = [thread.lead.email || latestInbound?.fromEmail].filter(Boolean) as string[];
    const draft = await prisma.$transaction(async (tx) => {
      await tx.draft.updateMany({
        where: {
          threadId: thread.id,
          draftType: "REPLY",
          isCurrent: true,
          status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] }
        },
        data: { isCurrent: false, supersededAt: new Date() }
      });
      const latestVersion = await tx.draft.findFirst({
        where: { threadId: thread.id, draftType: "REPLY" },
        orderBy: { draftVersion: "desc" },
        select: { draftVersion: true }
      });
      const created = await tx.draft.create({
        data: {
          threadId: thread.id,
          sourceEmailId: latestInbound?.id,
          basedOnEmailId: latestInbound?.id,
          basedOnMessageId: latestInbound?.messageId,
          basedOnEmailDate: latestInbound?.sentAt,
          draftVersion: (latestVersion?.draftVersion || 0) + 1,
          isCurrent: true,
          toEmails,
          subject,
          body: signatureText,
          bodyText: signatureText,
          bodyHtml: signatureHtml,
          draftType: "REPLY",
          promptVersion: "manual-reply",
          confidence: 1,
          trackingEnabled: true
        }
      });
      await tx.lead.update({
        where: { id: thread.lead!.id },
        data: { status: "DRAFT_CREATED" }
      });
      return created;
    });
    await logActivity({
      type: "DRAFT_GENERATED",
      message: "Manual reply draft created",
      leadId: thread.lead.id,
      threadId: thread.id,
      metadata: { draftId: draft.id, manual: true }
    });
    return jsonOk({ draft, manual: true, existingConversation: true });
  } catch (error) {
    return jsonError(error);
  }
}
