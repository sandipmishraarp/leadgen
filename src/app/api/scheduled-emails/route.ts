import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { resolveMailboxContext } from "@/lib/services/mailbox-filter";
import { scheduleDraft } from "@/lib/services/scheduled-email";

const schema = z.object({
  draftId: z.string().min(1),
  toEmails: z.array(z.string().email()).min(1),
  ccEmails: z.array(z.string().email()).default([]),
  bccEmails: z.array(z.string().email()).default([]),
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
  trackingEnabled: z.boolean().default(true),
  scheduleType: z.enum(["BEST", "CUSTOM"]),
  customClientLocalTime: z.string().optional(),
  fromEmail: z.string().email().optional(),
  safetyConfirmed: z.boolean().optional()
});

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const mailbox = await resolveMailboxContext(searchParams.get("mailbox") || searchParams.get("activeAccountEmail"), "abhay@aresourcepool.com");
    const scheduledEmails = await prisma.scheduledEmail.findMany({
      where: {
        fromEmail: { equals: mailbox.email, mode: "insensitive" },
        status: { in: ["SCHEDULED", "QUEUED", "FAILED"] }
      },
      orderBy: { scheduledAt: "asc" },
      include: { lead: true, draft: true },
      take: 200
    });
    return jsonOk({ scheduledEmails });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const scheduledEmail = await scheduleDraft({ ...input, createdBy: user.email });
    return jsonOk({ scheduledEmail });
  } catch (error) {
    return jsonError(error);
  }
}
