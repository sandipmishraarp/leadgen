import { prisma } from "@/lib/prisma";

export const FOLLOWUP_STATES = {
  DUE: "FOLLOWUP_DUE",
  DRAFT_CREATED: "DRAFT_CREATED",
  SCHEDULED: "SCHEDULED",
  SENT_WAITING_REPLY: "SENT_WAITING_REPLY",
  CLIENT_REPLIED: "CLIENT_REPLIED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
} as const;

export type FollowupState = typeof FOLLOWUP_STATES[keyof typeof FOLLOWUP_STATES];

export async function setLeadFollowupState(input: {
  leadId: string;
  state: FollowupState;
  draftId?: string | null;
  scheduledEmailId?: string | null;
  nextFollowUpAt?: Date | null;
}) {
  return prisma.lead.update({
    where: { id: input.leadId },
    data: {
      followupState: input.state,
      followupStateUpdatedAt: new Date(),
      ...(input.draftId !== undefined ? { followupDraftId: input.draftId } : {}),
      ...(input.scheduledEmailId !== undefined ? { followupScheduledEmailId: input.scheduledEmailId } : {}),
      ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : {})
    }
  });
}

export function nextStateForDueLead(input: {
  currentState?: string | null;
  hasDraft: boolean;
  hasScheduled: boolean;
  hasReplyAfterLatestOutbound: boolean;
  isDue: boolean;
  isTerminal: boolean;
}): FollowupState | null {
  if (input.currentState === FOLLOWUP_STATES.CANCELLED) return FOLLOWUP_STATES.CANCELLED;
  if (input.currentState === FOLLOWUP_STATES.COMPLETED) return FOLLOWUP_STATES.COMPLETED;
  if (input.isTerminal) return FOLLOWUP_STATES.COMPLETED;
  if (input.hasReplyAfterLatestOutbound) return FOLLOWUP_STATES.CLIENT_REPLIED;
  if (input.hasScheduled) return FOLLOWUP_STATES.SCHEDULED;
  if (input.hasDraft) return FOLLOWUP_STATES.DRAFT_CREATED;
  if (input.currentState === FOLLOWUP_STATES.SENT_WAITING_REPLY && !input.isDue) return FOLLOWUP_STATES.SENT_WAITING_REPLY;
  if (input.isDue) return FOLLOWUP_STATES.DUE;
  if (input.currentState === FOLLOWUP_STATES.SENT_WAITING_REPLY) return FOLLOWUP_STATES.SENT_WAITING_REPLY;
  return null;
}
