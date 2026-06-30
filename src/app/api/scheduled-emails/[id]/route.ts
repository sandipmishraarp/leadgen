import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { formatLocalTime, localDateTimeToUtc } from "@/lib/services/lead-intelligence";

const schema = z.object({
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
  scheduledClientLocalTime: z.string().optional(),
  trackingEnabled: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const existing = await prisma.scheduledEmail.findUnique({ where: { id: params.id } });
    if (!existing) return jsonOk({ error: "Scheduled email not found" }, { status: 404 });
    if (!["SCHEDULED", "QUEUED", "FAILED"].includes(existing.status)) {
      throw new Error("Only scheduled, queued, or failed emails can be edited.");
    }
    const timezone = existing.clientTimezone || "UTC";
    const scheduledAt = input.scheduledClientLocalTime
      ? localDateTimeToUtc(input.scheduledClientLocalTime, timezone)
      : existing.scheduledAt;
    const scheduledEmail = await prisma.scheduledEmail.update({
      where: { id: params.id },
      data: {
        subject: input.subject,
        body: input.body,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        attachmentMetadata: input.attachmentMetadata,
        scheduledAt,
        clientLocalScheduledAt: formatLocalTime(scheduledAt, timezone),
        trackingEnabled: input.trackingEnabled,
        status: existing.status === "FAILED" ? "QUEUED" : existing.status,
        failureReason: null
      }
    });
    return jsonOk({ scheduledEmail });
  } catch (error) {
    return jsonError(error);
  }
}
