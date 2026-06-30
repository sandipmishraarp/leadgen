import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountSecrets, getActiveAccount } from "@/lib/services/account";
import { logActivity } from "@/lib/services/activity";
import { PROMPT_LIBRARY } from "@/ai/prompts/prompt-library";
import { chooseAiModel, truncateText } from "@/lib/services/ai-usage";
import { routeAiText } from "@/lib/services/ai-router";

const MODEL = chooseAiModel("CLIENT_BRAIN");

type ClientBrainOutput = {
  summary: string;
  interestedService: string;
  budgetRange: string;
  objections: string[];
  painPoints: string[];
  preferredTone: string;
  preferredEmailTime: string;
  currentTemperature: string;
  recommendedNextStep: string;
  decisionStage: string;
  lastImportantEvent: string;
  nextBestAction: string;
};

type ClientBrainLeadContext = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  service: string | null;
  status: string;
  notes: string | null;
  clientEmailConfidence: number | null;
  qualification?: { score: number; classification: string; recommendedAction: string | null } | null;
  leadIntakes: Array<{
    subject: string;
    originalClientMessage: string | null;
    forwardedClientMessage: string | null;
    rawText: string | null;
    sourceProviderName: string | null;
    detectedProviderName: string | null;
    sourceFolderPath: string | null;
    receivedAt: Date;
  }>;
  threads: Array<{
    subject: string;
    emails: Array<{ direction: string; fromEmail: string; toEmails: string[]; subject: string; textBody: string | null; snippet: string | null; sentAt: Date }>;
    sentEmails: Array<{ subject: string; bodyText: string | null; body: string; sentAt: Date }>;
  }>;
  websiteVisits: Array<{ pageUrl: string; visitedAt: Date }>;
  proposalViews: Array<{ proposalUrl: string | null; viewedAt: Date }>;
};

export async function generateClientBrain(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      qualification: true,
      leadIntakes: { orderBy: { receivedAt: "desc" } },
      websiteVisits: { orderBy: { visitedAt: "desc" }, take: 10 },
      proposalViews: { orderBy: { viewedAt: "desc" }, take: 10 },
      threads: {
        orderBy: { lastMessageAt: "desc" },
        include: {
          emails: { orderBy: { sentAt: "asc" } },
          sentEmails: { orderBy: { sentAt: "asc" } }
        }
      }
    }
  });
  if (!lead) throw new Error("Lead not found");

  const context = buildClientBrainContext(lead);
  const generated = await generateWithOpenAI(context).catch(async (error) => {
    await logActivity({
      type: "ERROR",
      message: "Client brain AI generation failed; using deterministic fallback",
      leadId: lead.id,
      metadata: { error: error instanceof Error ? error.message : String(error) }
    });
    return buildFallbackBrain(lead);
  });

  const firstContactAt =
    lead.lastInboundAt ||
    lead.leadIntakes.at(-1)?.receivedAt ||
    lead.createdAt;

  const clientBrain = await prisma.clientBrain.upsert({
    where: { leadId: lead.id },
    create: {
      leadId: lead.id,
      firstContactAt,
      summary: generated.summary,
      interestedService: generated.interestedService || lead.service,
      budgetRange: generated.budgetRange || null,
      objections: generated.objections as Prisma.InputJsonValue,
      painPoints: generated.painPoints as Prisma.InputJsonValue,
      preferredTone: generated.preferredTone || "Professional and consultative",
      preferredEmailTime: generated.preferredEmailTime || lead.bestSendTime?.toISOString() || null,
      currentTemperature: generated.currentTemperature || lead.qualification?.classification || null,
      recommendedNextStep: generated.recommendedNextStep || null,
      decisionStage: generated.decisionStage || null,
      lastImportantEvent: generated.lastImportantEvent || null,
      nextBestAction: generated.nextBestAction || null
    },
    update: {
      firstContactAt,
      summary: generated.summary,
      interestedService: generated.interestedService || lead.service,
      budgetRange: generated.budgetRange || null,
      objections: generated.objections as Prisma.InputJsonValue,
      painPoints: generated.painPoints as Prisma.InputJsonValue,
      preferredTone: generated.preferredTone || "Professional and consultative",
      preferredEmailTime: generated.preferredEmailTime || lead.bestSendTime?.toISOString() || null,
      currentTemperature: generated.currentTemperature || lead.qualification?.classification || null,
      recommendedNextStep: generated.recommendedNextStep || null,
      decisionStage: generated.decisionStage || null,
      lastImportantEvent: generated.lastImportantEvent || null,
      nextBestAction: generated.nextBestAction || null
    }
  });

  await logActivity({
    type: "LEAD_STATUS_CHANGED",
    message: `Client brain refreshed for ${lead.email}`,
    leadId: lead.id,
    metadata: { currentTemperature: clientBrain.currentTemperature, decisionStage: clientBrain.decisionStage }
  });

  return clientBrain;
}

async function generateWithOpenAI(context: string): Promise<ClientBrainOutput> {
  const account = await getActiveAccount();
  const { openaiApiKey } = accountSecrets(account);
  if (!openaiApiKey) throw new Error("OpenAI API key is not configured.");

  return routeAiText({
    apiKey: openaiApiKey,
    feature: "CLIENT_BRAIN",
    model: MODEL,
    cacheInput: context,
    input: [
      {
        role: "system",
        content: PROMPT_LIBRARY.CLIENT_BRAIN
      },
      {
        role: "user",
        content: `
Lead and conversation context:
${context}

Return JSON only:
{
  "summary": "",
  "interestedService": "",
  "budgetRange": "",
  "objections": [],
  "painPoints": [],
  "preferredTone": "",
  "preferredEmailTime": "",
  "currentTemperature": "",
  "recommendedNextStep": "",
  "decisionStage": "",
  "lastImportantEvent": "",
  "nextBestAction": ""
}
`
      }
    ],
    parse: (text) => normalizeBrainOutput(parseJson(text))
  });
}

function buildClientBrainContext(lead: unknown) {
  const leadRecord = lead as ClientBrainLeadContext;

  const intake = leadRecord.leadIntakes[0];
  const messages = leadRecord.threads
    .flatMap((thread) =>
      thread.emails.map((email) => ({
        direction: email.direction,
        from: email.fromEmail,
        to: email.toEmails.join(", "),
        subject: email.subject,
        date: email.sentAt.toISOString(),
        body: truncateText(email.textBody || email.snippet || "", 500)
      }))
    )
    .slice(-6);

  return JSON.stringify(
    {
      lead: {
        name: leadRecord.name,
        email: leadRecord.email,
        company: leadRecord.company,
        phone: leadRecord.phone,
        website: leadRecord.website,
        country: leadRecord.country,
        service: leadRecord.service,
        status: leadRecord.status,
        notes: leadRecord.notes,
        clientEmailConfidence: leadRecord.clientEmailConfidence,
        qualification: leadRecord.qualification
      },
      latestIntake: intake
        ? {
            subject: intake.subject,
            provider: intake.sourceProviderName || intake.detectedProviderName,
            sourceFolderPath: intake.sourceFolderPath,
            receivedAt: intake.receivedAt.toISOString(),
            originalClientMessage: truncateText(intake.originalClientMessage || intake.forwardedClientMessage || intake.rawText || "", 900)
          }
        : null,
      conversation: messages,
      websiteVisits: leadRecord.websiteVisits.map((visit) => ({ pageUrl: visit.pageUrl, visitedAt: visit.visitedAt.toISOString() })),
      proposalViews: leadRecord.proposalViews.map((view) => ({ proposalUrl: view.proposalUrl, viewedAt: view.viewedAt.toISOString() }))
    },
    null,
    2
  ).slice(0, 6000);
}

function buildFallbackBrain(lead: {
  name: string | null;
  email: string;
  company: string | null;
  website: string | null;
  country: string | null;
  service: string | null;
  status: string;
  notes: string | null;
  qualification?: { classification: string; recommendedAction: string | null } | null;
  leadIntakes: Array<{ originalClientMessage: string | null; forwardedClientMessage: string | null; rawText: string | null; receivedAt: Date }>;
  websiteVisits: Array<unknown>;
  proposalViews: Array<unknown>;
}): ClientBrainOutput {
  const latestMessage = lead.leadIntakes[0]?.originalClientMessage || lead.leadIntakes[0]?.forwardedClientMessage || lead.leadIntakes[0]?.rawText || lead.notes || "";
  const hasEngagement = lead.websiteVisits.length > 0 || lead.proposalViews.length > 0;
  return {
    summary: `${lead.name || lead.email} is a ${lead.service || "service"} lead${lead.company ? ` from ${lead.company}` : ""}${lead.country ? ` in ${lead.country}` : ""}. ${truncate(latestMessage, 260)}`,
    interestedService: lead.service || "",
    budgetRange: "",
    objections: [],
    painPoints: extractPainPoints(latestMessage),
    preferredTone: "Professional, polite, and consultative",
    preferredEmailTime: "",
    currentTemperature: hasEngagement ? "WARM" : lead.qualification?.classification || "COLD",
    recommendedNextStep: lead.qualification?.recommendedAction || "Review the lead and send a concise consultative reply.",
    decisionStage: lead.status === "CONTACTED" ? "Contacted" : "Initial inquiry",
    lastImportantEvent: latestMessage ? "Lead inquiry imported." : "Lead created.",
    nextBestAction: lead.qualification?.recommendedAction || "Generate a first reply for human review."
  };
}

function normalizeBrainOutput(value: unknown): ClientBrainOutput {
  const record = typeof value === "object" && value ? value as Record<string, unknown> : {};
  return {
    summary: stringValue(record.summary),
    interestedService: stringValue(record.interestedService),
    budgetRange: stringValue(record.budgetRange),
    objections: stringArray(record.objections),
    painPoints: stringArray(record.painPoints),
    preferredTone: stringValue(record.preferredTone),
    preferredEmailTime: stringValue(record.preferredEmailTime),
    currentTemperature: stringValue(record.currentTemperature),
    recommendedNextStep: stringValue(record.recommendedNextStep),
    decisionStage: stringValue(record.decisionStage),
    lastImportantEvent: stringValue(record.lastImportantEvent),
    nextBestAction: stringValue(record.nextBestAction)
  };
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as unknown;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function extractPainPoints(value: string) {
  const text = value.toLowerCase();
  const painPoints: string[] = [];
  if (/seo|ranking|traffic|google/.test(text)) painPoints.push("Needs better search visibility or traffic.");
  if (/redesign|website|mobile|speed|conversion/.test(text)) painPoints.push("May need website UX, speed, or conversion improvements.");
  if (/app|mobile|mvp/.test(text)) painPoints.push("Needs a practical app/MVP plan.");
  if (/automation|manual|ai|workflow/.test(text)) painPoints.push("May want automation or workflow efficiency.");
  return painPoints;
}

function truncate(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}
