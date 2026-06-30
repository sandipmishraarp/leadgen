import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSenderAccountForLead } from "@/lib/services/account";
import { enforceSendSafety } from "@/lib/services/send-safety";

const schema = z.object({
  toEmails: z.array(z.string().email()).default([]),
  subject: z.string().default(""),
  body: z.string().default(""),
  bodyHtml: z.string().optional(),
  fromEmail: z.string().email().optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = schema.parse(await request.json().catch(() => ({})));
    const draft = await prisma.draft.findUnique({
      where: { id: params.id },
      include: { thread: { include: { lead: true } } }
    });
    if (!draft?.thread.lead) throw new Error("Draft is not linked to a lead.");
    const account = input.fromEmail
      ? await prisma.emailAccount.findFirst({ where: { emailAddress: { equals: input.fromEmail, mode: "insensitive" }, isActive: true } })
      : await getSenderAccountForLead(draft.thread.lead);
    if (!account) throw new Error("Sender account not found.");
    const decision = await enforceSendSafety({
      account,
      lead: draft.thread.lead,
      draftId: draft.id,
      threadId: draft.threadId,
      toEmails: input.toEmails.length ? input.toEmails : draft.toEmails,
      subject: input.subject || draft.subject,
      body: input.body || draft.bodyText || draft.body,
      bodyHtml: input.bodyHtml || draft.bodyHtml,
      safetyConfirmed: true,
      emailType: draft.draftType === "FOLLOWUP" ? "FOLLOW_UP" : undefined
    });
    return jsonOk({ decision });
  } catch (error) {
    return jsonError(error);
  }
}
