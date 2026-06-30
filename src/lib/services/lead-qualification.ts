import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";

type Reasoning = {
  positives: string[];
  negatives: string[];
  signals: Record<string, number | string | boolean | null>;
  caveats: string[];
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function calculateLeadQualification(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      leadIntakes: { orderBy: { receivedAt: "desc" } },
      websiteVisits: true,
      proposalViews: true,
      threads: {
        include: {
          emails: true,
          sentEmails: { include: { engagement: true } }
        }
      }
    }
  });
  if (!lead) throw new Error("Lead not found");

  const now = new Date();
  const leadAgeDays = Math.max(0, Math.floor((now.getTime() - lead.createdAt.getTime()) / MS_PER_DAY));
  const emails = lead.threads.flatMap((thread) => thread.emails);
  const inboundReplies = emails.filter((email) => email.direction === "INBOUND" && !email.isAutoReply && !email.isBounce);
  const engagements = lead.threads.flatMap((thread) => thread.sentEmails.map((sent) => sent.engagement).filter(Boolean));
  const openCount = engagements.reduce((sum, item) => sum + (item?.openCount || 0), 0);
  const clickedLinks = engagements.reduce((sum, item) => sum + (item?.clickedLinks || 0), 0);
  const engagementScore = engagements.reduce((sum, item) => sum + (item?.engagementScore || 0), 0);
  const engagementWebsiteVisits = engagements.reduce((sum, item) => sum + (item?.websiteVisits || 0), 0);
  const engagementProposalViews = engagements.reduce((sum, item) => sum + (item?.proposalViews || 0), 0);
  const websiteVisitCount = lead.websiteVisits.length + engagementWebsiteVisits;
  const proposalViewCount = lead.proposalViews.length + engagementProposalViews;
  const emailConfidence = lead.clientEmailConfidence ?? 0;
  const latestIntake = lead.leadIntakes[0];
  const provider = latestIntake?.sourceProviderName || latestIntake?.detectedProviderName || latestIntake?.sourceFolder || lead.source;

  let score = 20;
  const reasoning: Reasoning = {
    positives: [],
    negatives: [],
    signals: {
      emailConfidence,
      websitePresent: Boolean(lead.website),
      serviceIdentified: Boolean(lead.service),
      countryIdentified: Boolean(lead.country),
      companyPresent: Boolean(lead.company),
      phonePresent: Boolean(lead.phone),
      leadAgeDays,
      inboundReplyCount: inboundReplies.length,
      openCount,
      clickedLinks,
      websiteVisitCount,
      proposalViewCount,
      followupStage: lead.followupStage,
      provider,
      engagementScore,
      status: lead.status
    },
    caveats: []
  };

  const add = (points: number, reason: string) => {
    score += points;
    reasoning.positives.push(reason);
  };
  const subtract = (points: number, reason: string) => {
    score -= points;
    reasoning.negatives.push(reason);
  };

  if (emailConfidence >= 90) add(10, "Client email has high extraction confidence.");
  else if (emailConfidence >= 80) add(6, "Client email confidence is acceptable.");
  else if (emailConfidence > 0) subtract(18, "Client email confidence is below 80%, so outreach needs human confirmation.");
  else {
    subtract(14, "Client email confidence is missing.");
    reasoning.caveats.push("Email confidence is not available, so score confidence is limited.");
  }

  if (lead.website) add(8, "Website is available for personalization and qualification.");
  else subtract(6, "Website is missing.");
  if (lead.service) add(10, "Requested service is identified.");
  else subtract(8, "Requested service is unclear.");
  if (lead.country) add(5, "Country is identified for timezone and localization.");
  if (lead.company) add(5, "Company is available.");
  if (lead.phone) add(4, "Phone number is available.");

  if (inboundReplies.length > 0 || lead.lastInboundAt) add(18, "A client reply or inbound interaction is present.");
  if (clickedLinks > 0) add(Math.min(16, 8 + clickedLinks * 3), "Lead clicked tracked link(s), a strong buying signal.");
  if (websiteVisitCount > 0) add(Math.min(14, 7 + websiteVisitCount * 2), "Lead visited tracked website/proposal pages.");
  if (proposalViewCount > 0) add(Math.min(16, 9 + proposalViewCount * 3), "Proposal or shared asset was viewed.");
  if (openCount > 0) add(Math.min(8, 2 + openCount), "Lead opened email(s); treated as a soft signal only.");
  if (engagementScore > 0) add(Math.min(8, Math.round(engagementScore / 20)), "Engagement score adds supporting signal.");

  if (leadAgeDays > 60 && !hasStrongEngagement(inboundReplies.length, clickedLinks, websiteVisitCount, proposalViewCount)) {
    subtract(12, "Lead is older than 60 days without strong engagement.");
  } else if (leadAgeDays > 30 && !hasStrongEngagement(inboundReplies.length, clickedLinks, websiteVisitCount, proposalViewCount)) {
    subtract(6, "Lead is older than 30 days without strong engagement.");
  }

  if (lead.followupStage >= 3 && !lead.lastInboundAt) subtract(5, "Multiple follow-ups without a reply reduce urgency.");
  if (lead.waitingForReply && lead.nextFollowUpAt && lead.nextFollowUpAt <= now) add(5, "Follow-up is due now.");

  if (["REJECTED", "LOST", "ARCHIVED"].includes(lead.status)) subtract(35, `Lead status is ${lead.status}.`);
  if (lead.status === "WON") add(25, "Lead is marked won.");
  if (lead.status === "CONTACTED") add(4, "Lead has been contacted.");

  score = clamp(score, 0, 100);
  if (emailConfidence > 0 && emailConfidence < 80) score = Math.min(score, 55);

  const strongSignal = hasStrongEngagement(inboundReplies.length, clickedLinks, websiteVisitCount, proposalViewCount);
  const classification = classifyLead(score, emailConfidence, strongSignal, lead.status);
  const winProbability = calculateWinProbability(score, classification, strongSignal, emailConfidence);
  const dealSizeEstimate = estimateDealSize(lead.service);
  const confidence = calculateConfidence({
    emailConfidence,
    hasWebsite: Boolean(lead.website),
    hasService: Boolean(lead.service),
    hasCountry: Boolean(lead.country),
    hasCompany: Boolean(lead.company),
    hasPhone: Boolean(lead.phone),
    hasThread: emails.length > 0,
    hasEngagement: openCount + clickedLinks + websiteVisitCount + proposalViewCount > 0
  });
  const recommendedAction = recommendAction({
    classification,
    score,
    emailConfidence,
    status: lead.status,
    waitingForReply: lead.waitingForReply,
    followupDue: Boolean(lead.nextFollowUpAt && lead.nextFollowUpAt <= now),
    strongSignal
  });

  const qualification = await prisma.leadQualification.upsert({
    where: { leadId: lead.id },
    create: {
      leadId: lead.id,
      score,
      classification,
      dealSizeEstimate,
      winProbability,
      reasoning: reasoning as Prisma.InputJsonValue,
      recommendedAction,
      confidence,
      scoredAt: now
    },
    update: {
      score,
      classification,
      dealSizeEstimate,
      winProbability,
      reasoning: reasoning as Prisma.InputJsonValue,
      recommendedAction,
      confidence,
      scoredAt: now
    }
  });

  await logActivity({
    type: "LEAD_STATUS_CHANGED",
    message: `Lead qualification recalculated for ${lead.email}`,
    leadId: lead.id,
    metadata: { score, classification, winProbability, confidence }
  });

  return qualification;
}

function hasStrongEngagement(replies: number, clicks: number, visits: number, proposalViews: number) {
  return replies > 0 || clicks > 0 || visits > 0 || proposalViews > 0;
}

function classifyLead(score: number, emailConfidence: number, strongSignal: boolean, status: string) {
  if (["REJECTED", "LOST", "ARCHIVED"].includes(status) || (emailConfidence > 0 && emailConfidence < 55)) return "LOW_QUALITY";
  if (score >= 75 && strongSignal && emailConfidence >= 80) return "HOT";
  if (score >= 55) return "WARM";
  if (score >= 30) return "COLD";
  return "LOW_QUALITY";
}

function calculateWinProbability(score: number, classification: string, strongSignal: boolean, emailConfidence: number) {
  let probability = Math.round(score * 0.72);
  if (classification === "HOT") probability += 12;
  if (classification === "WARM") probability += 4;
  if (classification === "LOW_QUALITY") probability -= 12;
  if (strongSignal) probability += 6;
  if (emailConfidence > 0 && emailConfidence < 80) probability = Math.min(probability, 35);
  return clamp(probability, 5, 85);
}

function estimateDealSize(service: string | null) {
  const value = (service || "").toLowerCase();
  if (/(seo|ranking|traffic|digital marketing|local search)/.test(value)) return 1200;
  if (/(mobile|app|android|ios|mvp|flutter|react native)/.test(value)) return 5500;
  if (/(ai|automation|agent|chatbot|workflow|openai)/.test(value)) return 9000;
  if (/(crm|hubspot|salesforce|pipeline|lead management)/.test(value)) return 4500;
  if (/(software|saas|portal|dashboard|backend|api)/.test(value)) return 9000;
  if (/(website|redesign|wordpress|shopify|woocommerce|webflow|wix)/.test(value)) return 1800;
  return null;
}

function calculateConfidence(input: {
  emailConfidence: number;
  hasWebsite: boolean;
  hasService: boolean;
  hasCountry: boolean;
  hasCompany: boolean;
  hasPhone: boolean;
  hasThread: boolean;
  hasEngagement: boolean;
}) {
  let confidence = 35;
  if (input.emailConfidence >= 80) confidence += 18;
  else if (input.emailConfidence > 0) confidence += 8;
  if (input.hasWebsite) confidence += 8;
  if (input.hasService) confidence += 10;
  if (input.hasCountry) confidence += 6;
  if (input.hasCompany) confidence += 5;
  if (input.hasPhone) confidence += 4;
  if (input.hasThread) confidence += 8;
  if (input.hasEngagement) confidence += 8;
  if (input.emailConfidence > 0 && input.emailConfidence < 80) confidence = Math.min(confidence, 65);
  return clamp(confidence, 20, 92);
}

function recommendAction(input: {
  classification: string;
  score: number;
  emailConfidence: number;
  status: string;
  waitingForReply: boolean;
  followupDue: boolean;
  strongSignal: boolean;
}) {
  if (input.emailConfidence > 0 && input.emailConfidence < 80) return "Confirm the client email before drafting or scheduling outreach.";
  if (["REJECTED", "LOST", "ARCHIVED"].includes(input.status)) return "Keep archived unless a human decides to revive this lead.";
  if (input.classification === "HOT") return "Prioritize today with a tailored reply, clear next step, and fast human review.";
  if (input.followupDue || input.waitingForReply) return "Send a concise consultative follow-up after review.";
  if (input.classification === "WARM") return "Generate a personalized first reply or helpful follow-up using the client context.";
  if (input.strongSignal) return "Review recent engagement and send a low-pressure next-step email.";
  return "Nurture carefully; improve missing lead data before heavy follow-up.";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
