import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildLeadIntelligence } from "@/lib/services/lead-intelligence";

const schema = z.object({
  timezone: z.string().min(1).optional(),
  scheduleForBestTime: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const lead = await prisma.lead.findUnique({
      where: { id: params.id },
      include: {
        threads: {
          include: {
            emails: true,
            sentEmails: { include: { engagement: true } }
          }
        }
      }
    });
    if (!lead) return jsonOk({ error: "Lead not found" }, { status: 404 });

    const updatedTimezoneLead = input.timezone
      ? await prisma.lead.update({
          where: { id: lead.id },
          data: {
            timezone: input.timezone,
            timezoneConfidence: 100,
            intelligenceUpdatedAt: new Date()
          },
          include: {
            threads: {
              include: {
                emails: true,
                sentEmails: { include: { engagement: true } }
              }
            }
          }
        })
      : lead;

    const intelligence = buildLeadIntelligence(updatedTimezoneLead);
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        timezone: intelligence.detectedTimezone,
        timezoneConfidence: intelligence.timezoneConfidence,
        bestSendTime: new Date(intelligence.nextBestSendTimeIso),
        lastRecommendedSendTime: input.scheduleForBestTime ? new Date(intelligence.nextBestSendTimeIso) : new Date(),
        suggestedEmailAngle: intelligence.suggestedEmailAngle,
        replyProbability: intelligence.replyProbability,
        intelligenceUpdatedAt: new Date()
      }
    });

    return jsonOk({ lead: updated, intelligence });
  } catch (error) {
    return jsonError(error);
  }
}
