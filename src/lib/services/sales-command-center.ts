import { prisma } from "@/lib/prisma";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";

type SalesAction = {
  id: string;
  leadId: string;
  client: string;
  email: string;
  status: string;
  priority: number;
  reason: string;
  recommendedAction: string;
  href: string;
};

const proposalKeywords = /\b(proposal|pricing|price|cost|quote|estimate|budget|timeline|srs|scope)\b/i;

export async function getDailySalesCommandCenter() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const [leads, scheduledDueToday, failedSends] = await Promise.all([
    prisma.lead.findMany({
      where: {
        status: { notIn: ["WON", "LOST", "ARCHIVED", "REJECTED"] }
      },
      include: {
        qualification: true,
        proposalViews: true,
        websiteVisits: true,
        threads: {
          include: {
            emails: { orderBy: { sentAt: "desc" }, take: 6 },
            drafts: { where: { status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
            sentEmails: { include: { engagement: true }, orderBy: { sentAt: "desc" }, take: 3 }
          },
          orderBy: { lastMessageAt: "desc" },
          take: 3
        },
        scheduledEmails: {
          where: { status: { in: ["SCHEDULED", "QUEUED", "RETRY", "FAILED"] } },
          orderBy: { scheduledAt: "asc" },
          take: 3
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 250
    }),
    prisma.scheduledEmail.findMany({
      where: { scheduledAt: { gte: start, lte: end }, status: { in: ["SCHEDULED", "QUEUED", "RETRY"] } },
      include: { lead: true },
      orderBy: { scheduledAt: "asc" },
      take: 30
    }),
    prisma.scheduledEmail.findMany({
      where: { status: "FAILED" },
      include: { lead: true },
      orderBy: { updatedAt: "desc" },
      take: 30
    })
  ]);

  const leadActions = leads.map((lead) => scoreLeadAction(lead)).filter(Boolean) as SalesAction[];
  const scheduledActions = scheduledDueToday.map((item) => ({
    id: `scheduled-${item.id}`,
    leadId: item.leadId,
    client: item.lead.name || item.lead.email,
    email: item.toEmail,
    status: item.status,
    priority: 75,
    reason: "Approved email is due today.",
    recommendedAction: "Send Due Email",
    href: "/scheduled"
  }));
  const failedActions = failedSends.map((item) => ({
    id: `failed-${item.id}`,
    leadId: item.leadId,
    client: item.lead.name || item.lead.email,
    email: item.toEmail,
    status: "FAILED",
    priority: 80,
    reason: item.failureReason || "A scheduled/send queue item failed.",
    recommendedAction: "Review Failed Send",
    href: "/scheduled"
  }));

  const actions = [...leadActions, ...scheduledActions, ...failedActions]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  const counts = {
    replies: leadActions.filter((item) => item.recommendedAction === "Reply Now").length,
    drafts: leadActions.filter((item) => item.recommendedAction === "Review Draft").length,
    followups: leadActions.filter((item) => item.recommendedAction === "Schedule Follow-up").length,
    scheduledToday: scheduledDueToday.length,
    failedSends: failedSends.length,
    hotLeads: leadActions.filter((item) => item.priority >= 70 && !["Blocked / Do Not Contact", "Archive"].includes(item.recommendedAction)).length,
    blocked: leadActions.filter((item) => item.recommendedAction === "Blocked / Do Not Contact").length,
    revival: leadActions.filter((item) => item.recommendedAction === "Revival Review").length
  };

  return {
    counts,
    morningBrief: `Today you have ${counts.replies} replies, ${counts.drafts} drafts ready, ${counts.followups} follow-ups due, ${counts.failedSends} failed sends, and ${counts.hotLeads} hot leads.`,
    actions
  };
}

function scoreLeadAction(lead: any): SalesAction | null {
  const emails = lead.threads.flatMap((thread: any) => thread.emails.map((email: any) => ({ ...email, threadId: thread.id })));
  const drafts = lead.threads.flatMap((thread: any) => thread.drafts.map((draft: any) => ({ ...draft, threadId: thread.id })));
  const engagements = lead.threads.flatMap((thread: any) => thread.sentEmails.map((sent: any) => sent.engagement).filter(Boolean));
  const latestInbound = emails.filter((email: any) => email.direction === "INBOUND").sort((a: any, b: any) => b.sentAt.getTime() - a.sentAt.getTime())[0];
  const latestOutbound = emails.filter((email: any) => email.direction === "OUTBOUND").sort((a: any, b: any) => b.sentAt.getTime() - a.sentAt.getTime())[0];
  const clickedLinks = engagements.reduce((sum: number, item: any) => sum + Number(item.clickedLinks || 0), 0);
  const openCount = engagements.reduce((sum: number, item: any) => sum + Number(item.openCount || 0), 0);
  const latestText = [latestInbound?.subject, latestInbound?.snippet, latestInbound?.textBody, lead.notes].filter(Boolean).join("\n");
  const blockText = String(lead.notes || "").toLowerCase();
  const blocked = Boolean(/do not contact|unsubscribe|stop|not interested|\[auto_block/.test(blockText));
  const bounced = /bounce|bounced|delivery failed|invalid email/.test(blockText);
  const spam = /\[AUTO_CLASSIFICATION:MARKETING_SPAM\]|spam|marketing/.test(blockText);
  const lowConfidence = typeof lead.clientEmailConfidence === "number" && lead.clientEmailConfidence < 80;
  const hasClientReply = Boolean(latestInbound && (!latestOutbound || latestInbound.sentAt > latestOutbound.sentAt));
  const hasDraft = drafts.length > 0;
  const scheduled = lead.scheduledEmails.find((item: any) => ["SCHEDULED", "QUEUED", "RETRY"].includes(item.status));
  const followupOverdue = Boolean(lead.followupState === FOLLOWUP_STATES.DUE || (lead.nextFollowUpAt && lead.nextFollowUpAt <= new Date()));
  const oldLead = daysSince(lead.createdAt) >= 731;

  let score = 0;
  const reasons: string[] = [];
  if (hasClientReply) add(30, "Client replied");
  if (clickedLinks > 0) add(25, "Clicked link");
  if (openCount >= 2) add(20, "Opened email 2+ times");
  if (proposalKeywords.test(latestText)) add(20, "Pricing/proposal intent");
  if (followupOverdue) add(15, "Follow-up overdue");
  if (lead.website) add(10, "Website available");
  if (blocked) add(-40, "Do-not-contact");
  if (bounced) add(-30, "Bounced");
  if (spam) add(-20, "Spam/marketing");
  if (lowConfidence) add(-10, "Low email confidence");
  if (lead.qualification?.classification === "HOT") add(15, "Hot qualification");

  const recommendedAction = decideAction({ blocked, bounced, spam, hasDraft, scheduled, hasClientReply, followupOverdue, oldLead });
  if (recommendedAction === "Waiting") return null;
  score = Math.max(0, Math.min(100, score));
  return {
    id: `lead-${lead.id}`,
    leadId: lead.id,
    client: lead.name || lead.company || lead.email,
    email: lead.email,
    status: blocked ? "DO_NOT_CONTACT" : spam ? "MARKETING_SPAM" : lead.status,
    priority: score,
    reason: reasons.slice(0, 3).join(", ") || "Needs review",
    recommendedAction,
    href: actionHref(recommendedAction, lead.id)
  };

  function add(points: number, reason: string) {
    score += points;
    reasons.push(reason);
  }
}

function decideAction(input: {
  blocked: boolean;
  bounced: boolean;
  spam: boolean;
  hasDraft: boolean;
  scheduled: unknown;
  hasClientReply: boolean;
  followupOverdue: boolean;
  oldLead: boolean;
}) {
  if (input.blocked || input.bounced) return "Blocked / Do Not Contact";
  if (input.spam) return "Archive";
  if (input.hasDraft) return "Review Draft";
  if (input.scheduled) return "Send Due Email";
  if (input.hasClientReply) return "Reply Now";
  if (input.followupOverdue) return "Schedule Follow-up";
  if (input.oldLead) return "Revival Review";
  return "Waiting";
}

function actionHref(action: string, leadId: string) {
  if (action === "Reply Now") return `/leads/${leadId}#drafts-composer`;
  if (action === "Review Draft") return `/leads/${leadId}#drafts-composer`;
  if (action === "Schedule Follow-up") return "/followups?tab=draft-pending";
  if (action === "Send Due Email") return "/scheduled";
  if (action === "Revival Review") return `/leads/${leadId}`;
  if (action === "Archive") return `/leads/${leadId}`;
  return `/leads/${leadId}`;
}

function daysSince(value: Date) {
  return Math.floor((Date.now() - value.getTime()) / 86_400_000);
}
