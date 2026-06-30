import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { logActivity } from "@/lib/services/activity";
import { mergeLeadByClientEmail } from "@/lib/services/lead-merge";
import { generateFirstReplyDraft } from "@/lib/services/openai";
import { findRelatedLeadIntakeMessages } from "@/lib/services/lead-intake-grouping";

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT", "HOLD", "ARCHIVE", "CONFIRM_EMAIL", "CONTINUE_ABHAY", "GENERATE_ABHAY_DRAFT", "ACCEPT_CONTINUE", "REJECT_PERMANENTLY"]),
  clientEmail: z.string().email().optional(),
  notes: z.string().optional(),
  assignedUser: z.string().optional(),
  assignedEmailAccount: z.string().optional(),
  actionType: z.enum(["FIRST_REPLY", "FOLLOW_UP", "REVIVAL"]).optional()
});

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const item = await prisma.leadIntake.findUnique({
      where: { id: params.id },
      include: {
        lead: { select: { id: true, status: true } },
        account: { select: { id: true, emailAddress: true, role: true } }
      }
    });
    if (!item) return jsonOk({ error: "Lead intake item not found" }, { status: 404 });
    const relatedMessages = await findRelatedLeadIntakeMessages(prisma, item);
    return jsonOk({ item: { ...item, relatedMessages } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const intake = await prisma.leadIntake.findUnique({ where: { id: params.id } });
    if (!intake) return jsonOk({ error: "Lead intake item not found" }, { status: 404 });

    const status = actionToStatus(input.action);
    const clientEmail = (input.clientEmail || intake.extractedClientEmail || "").toLowerCase();
    const continuing = input.action === "CONTINUE_ABHAY" || input.action === "GENERATE_ABHAY_DRAFT" || input.action === "ACCEPT_CONTINUE";

    const result = await prisma.$transaction(async (tx) => {
      let leadId = intake.leadId;
      const actionType = input.actionType || defaultActionType(intake.receivedAt || intake.importedAt);
      if (["APPROVE", "CONFIRM_EMAIL", "CONTINUE_ABHAY", "GENERATE_ABHAY_DRAFT", "ACCEPT_CONTINUE"].includes(input.action)) {
        if (!clientEmail) throw new Error("Client email is required before approving this lead.");
        const assignedEmailAccount = continuing ? "abhay@aresourcepool.com" : input.assignedEmailAccount;
        const actionTypeForLead = intake.replyMode === "continue_existing_conversation" ? "FIRST_REPLY" : actionType;
        const lead = await mergeLeadByClientEmail(tx, {
          clientEmail,
          name: intake.extractedName,
          company: intake.extractedCompany,
          phone: intake.extractedPhone,
          website: intake.extractedWebsite,
          country: intake.extractedCountry,
          service: intake.extractedService,
          source: "lead_intake",
          status: input.action === "APPROVE" ? "APPROVED" : continuing ? "NEEDS_REPLY" : "WAITING_FOR_SANDIP",
          originalClientMessage: intake.latestClientMessage || intake.originalClientMessage || intake.forwardedClientMessage,
          notes: mergeActionTypeNote(
            mergeForwardedContextNote(input.notes, intake),
            actionTypeForLead
          ),
          clientEmailConfidence: intake.extractionConfidence,
          clientEmailReason: intake.extractionReason
        });
        if (assignedEmailAccount || actionTypeForLead) {
          await tx.lead.update({
            where: { id: lead.id },
            data: {
              assignedUser: continuing ? "Abhay" : input.assignedUser,
              assignedEmailAccount,
              assignedBy: assignedEmailAccount ? user.email : undefined,
              assignedAt: assignedEmailAccount ? new Date() : undefined,
              currentMailbox: assignedEmailAccount,
              notes: mergeActionTypeNote(mergeForwardedContextNote(lead.notes, intake), actionTypeForLead)
            }
          });
        }
        leadId = lead.id;
      } else if (leadId) {
        await tx.lead.update({
          where: { id: leadId },
          data: { status }
        });
      }

      const updated = await tx.leadIntake.update({
        where: { id: intake.id },
        data: {
          leadId,
          status: continuing ? "NEEDS_REPLY" : status,
          extractedClientEmail: clientEmail || intake.extractedClientEmail,
          needsManualConfirmation: input.action === "APPROVE" || input.action === "CONFIRM_EMAIL" || continuing ? false : intake.needsManualConfirmation,
          confirmedClientEmailAt: input.action === "APPROVE" || input.action === "CONFIRM_EMAIL" || continuing ? new Date() : intake.confirmedClientEmailAt,
          confirmedClientEmailBy: input.action === "APPROVE" || input.action === "CONFIRM_EMAIL" || continuing ? user.email : intake.confirmedClientEmailBy,
          sandipReviewRequired: input.action === "ACCEPT_CONTINUE" || input.action === "REJECT_PERMANENTLY" || input.action === "HOLD"
            ? false
            : intake.sandipReviewRequired,
          sandipDecisionStatus: input.action === "ACCEPT_CONTINUE"
            ? "accepted"
            : input.action === "REJECT_PERMANENTLY"
              ? "rejected"
              : input.action === "HOLD"
                ? "hold"
                : intake.sandipDecisionStatus,
          allowContinueAsAbhay: input.action === "ACCEPT_CONTINUE" || continuing
        },
        include: { lead: true }
      });
      return updated;
    });

    let draft = null;
    if (input.action === "GENERATE_ABHAY_DRAFT" && result.leadId) {
      draft = await generateFirstReplyDraft(result.leadId);
    }

    await logActivity({
      type: "LEAD_STATUS_CHANGED",
      message: `Lead intake ${input.action.toLowerCase()} by ${user.email}`,
      leadId: result.leadId || undefined,
      metadata: { intakeId: intake.id, action: input.action, draftId: draft?.id }
    });

    return jsonOk({ item: result, draft });
  } catch (error) {
    return jsonError(error);
  }
}

function actionToStatus(action: z.infer<typeof schema>["action"]) {
  if (action === "ACCEPT_CONTINUE") return "NEEDS_REPLY";
  if (action === "REJECT_PERMANENTLY") return "REJECTED";
  if (action === "CONFIRM_EMAIL") return "WAITING_FOR_SANDIP";
  if (action === "CONTINUE_ABHAY" || action === "GENERATE_ABHAY_DRAFT") return "NEEDS_REPLY";
  if (action === "APPROVE") return "APPROVED";
  if (action === "REJECT") return "REJECTED";
  if (action === "HOLD") return "HOLD";
  return "ARCHIVED";
}

function defaultActionType(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 30) return "FIRST_REPLY";
  if (days <= 180) return "FOLLOW_UP";
  return "REVIVAL";
}

function mergeActionTypeNote(notes: string | null | undefined, actionType: string) {
  const clean = (notes || "").replace(/\n?\[AI_SALES_ACTION_TYPE:[^\]]+\]/g, "").trim();
  return [clean, `[AI_SALES_ACTION_TYPE:${actionType}]`].filter(Boolean).join("\n");
}

function mergeForwardedContextNote(notes: string | null | undefined, intake: any) {
  const clean = (notes || "").replace(/\n?\[FORWARDED_LEAD_CONTEXT:[\s\S]*?\]/g, "").trim();
  if (intake.replyMode !== "continue_existing_conversation" && intake.leadSourceType !== "forwarded_provider_lead") return clean;
  const context = [
    "[FORWARDED_LEAD_CONTEXT:",
    `lead_source_type=${intake.leadSourceType || "forwarded_provider_lead"}`,
    `conversation_type=${intake.conversationType || "warm_reply"}`,
    `reply_mode=${intake.replyMode || "continue_existing_conversation"}`,
    `detected_intent=${intake.detectedIntent || "UNKNOWN"}`,
    `requested_items=${Array.isArray(intake.requestedItems) ? intake.requestedItems.join(", ") : ""}`,
    `latest_client_message=${(intake.latestClientMessage || intake.originalClientMessage || "").slice(0, 1000)}`,
    "]"
  ].join("\n");
  return [clean, context].filter(Boolean).join("\n\n");
}
