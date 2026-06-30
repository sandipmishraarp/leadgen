import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";

export async function GET() {
  try {
    await requireUser();
    const [leads, drafts, sentEmails, followupDue, followupDraftPending, followupScheduled, followupWaitingReply, followupCompleted, recentThreads, logs] = await Promise.all([
      prisma.lead.count(),
      prisma.draft.count({ where: { status: "DRAFT" } }),
      prisma.sentEmail.count(),
      prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.DUE } }),
      prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.DRAFT_CREATED } }),
      prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.SCHEDULED } }),
      prisma.lead.count({ where: { followupState: FOLLOWUP_STATES.SENT_WAITING_REPLY } }),
      prisma.lead.count({ where: { followupState: { in: [FOLLOWUP_STATES.CLIENT_REPLIED, FOLLOWUP_STATES.COMPLETED, FOLLOWUP_STATES.CANCELLED] } } }),
      prisma.emailThread.findMany({
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        include: { lead: true, emails: { orderBy: { sentAt: "desc" }, take: 1 } }
      }),
      prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 })
    ]);
    return jsonOk({
      counts: {
        leads,
        drafts,
        sentEmails,
        followupDue,
        followupDraftPending,
        followupScheduled,
        followupWaitingReply,
        followupCompleted
      },
      recentThreads,
      logs
    });
  } catch (error) {
    return jsonError(error);
  }
}
