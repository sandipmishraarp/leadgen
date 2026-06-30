import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const scheduledEmail = await prisma.scheduledEmail.update({
      where: { id: params.id },
      data: { status: "CANCELLED" }
    });
    if (scheduledEmail.draftId) {
      await prisma.draft.update({
        where: { id: scheduledEmail.draftId },
        data: { status: "DRAFT" }
      });
    }
    await prisma.lead.update({
      where: { id: scheduledEmail.leadId },
      data: {
        followupState: FOLLOWUP_STATES.CANCELLED,
        followupStateUpdatedAt: new Date(),
        followupScheduledEmailId: scheduledEmail.id
      }
    });
    return jsonOk({ scheduledEmail });
  } catch (error) {
    return jsonError(error);
  }
}
