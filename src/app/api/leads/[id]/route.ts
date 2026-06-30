import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";

const schema = z.object({
  status: z
    .enum([
      "WAITING_FOR_SANDIP",
      "APPROVED",
      "REJECTED",
      "HOLD",
      "ARCHIVED",
      "NEEDS_REPLY",
      "CLIENT_REPLIED",
      "CONTACTED",
      "NEW",
      "DRAFT_CREATED",
      "REPLIED",
      "FOLLOW_UP_NEEDED",
      "PROPOSAL_SENT",
      "WON",
      "LOST"
    ])
    .optional(),
  notes: z.string().optional().nullable(),
  nextFollowUpAt: z.string().datetime().optional().nullable(),
  assignedEmailAccount: z.string().optional().nullable(),
  assignedUser: z.string().optional().nullable(),
  currentMailbox: z.string().optional().nullable()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const isAssignment = input.status === "APPROVED" && Boolean(input.assignedEmailAccount || input.assignedUser);
    const lead = await prisma.lead.update({
      where: { id: params.id },
      data: {
        status: input.status,
        notes: input.notes,
        nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : input.nextFollowUpAt,
        assignedEmailAccount: input.assignedEmailAccount,
        assignedUser: input.assignedUser,
        assignedAt: isAssignment ? new Date() : undefined,
        assignedBy: isAssignment ? user.email : undefined,
        currentMailbox: input.currentMailbox || input.assignedEmailAccount
      }
    });
    await logActivity({
      type: "LEAD_STATUS_CHANGED",
      message: `Lead ${lead.email} updated`,
      leadId: lead.id,
      metadata: input
    });
    return jsonOk({ lead });
  } catch (error) {
    return jsonError(error);
  }
}
