import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { sendApprovedDraft } from "@/lib/services/smtp";

const schema = z.object({
  toEmails: z.array(z.string().email()).optional(),
  ccEmails: z.array(z.string().email()).optional(),
  bccEmails: z.array(z.string().email()).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  attachmentMetadata: z.array(z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    type: z.string()
  })).optional(),
  trackingEnabled: z.boolean().optional(),
  safetyConfirmed: z.boolean().optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = schema.parse(await request.json().catch(() => ({})));
    const sent = await sendApprovedDraft(params.id, input);
    return jsonOk({ sent });
  } catch (error) {
    return jsonError(error);
  }
}
