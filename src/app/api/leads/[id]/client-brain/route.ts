import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { generateClientBrain } from "@/lib/services/client-brain";

const editableClientBrainSchema = z.object({
  summary: z.string().optional().nullable(),
  interestedService: z.string().optional().nullable(),
  budgetRange: z.string().optional().nullable(),
  objections: z.array(z.string()).optional().nullable(),
  painPoints: z.array(z.string()).optional().nullable(),
  preferredTone: z.string().optional().nullable(),
  preferredEmailTime: z.string().optional().nullable(),
  currentTemperature: z.string().optional().nullable(),
  recommendedNextStep: z.string().optional().nullable(),
  decisionStage: z.string().optional().nullable(),
  lastImportantEvent: z.string().optional().nullable(),
  nextBestAction: z.string().optional().nullable()
});

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const clientBrain = await generateClientBrain(params.id);
    return jsonOk({ clientBrain });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = editableClientBrainSchema.parse(await request.json());
    const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true, email: true, createdAt: true } });
    if (!lead) throw new Error("Lead not found");
    const data = normalizeClientBrainInput(input);

    const clientBrain = await prisma.clientBrain.upsert({
      where: { leadId: lead.id },
      create: {
        leadId: lead.id,
        firstContactAt: lead.createdAt,
        ...data
      },
      update: data
    });

    await logActivity({
      type: "LEAD_STATUS_CHANGED",
      message: `Client brain edited for ${lead.email}`,
      leadId: lead.id,
      metadata: { editedFields: Object.keys(input) }
    });

    return jsonOk({ clientBrain });
  } catch (error) {
    return jsonError(error);
  }
}

function normalizeClientBrainInput(input: z.infer<typeof editableClientBrainSchema>) {
  return {
    ...input,
    objections: input.objections === null ? Prisma.JsonNull : input.objections,
    painPoints: input.painPoints === null ? Prisma.JsonNull : input.painPoints
  };
}
