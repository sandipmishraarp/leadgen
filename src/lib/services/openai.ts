import type { ClientBrain } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { accountSecrets, getActiveAccount, getSenderAccountForLead } from "@/lib/services/account";
import { generateSalesEmail, type GenerateSalesEmailInput, type GeneratedSalesEmail } from "@/ai/generate-sales-email";
import { buildLeadIntelligence } from "@/lib/services/lead-intelligence";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { retrieveVectorKnowledge } from "@/lib/services/vector-knowledge";
import { normalizeSubject } from "@/lib/services/threading";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const PROMPT_VERSION = "phase1-context-v2";

type DraftKind = "REPLY" | "FOLLOWUP";
type EmailGenerationType = "FIRST_REPLY" | "REPLY" | "FOLLOW_UP";

export async function generateFirstReplyDraft(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      leadIntakes: { orderBy: { receivedAt: "desc" } },
      threads: {
        orderBy: { lastMessageAt: "desc" },
        include: {
          emails: { orderBy: { sentAt: "asc" } },
          sentEmails: { include: { engagement: true } }
        }
      },
      clientBrain: true,
      qualification: true
    }
  });
  if (!lead) throw new Error("Lead not found");
  if (!lead.email) throw new Error("Lead client email is required before generating first reply.");

  const account = await getSenderAccountForLead(lead);
  const { openaiApiKey } = accountSecrets(account);
  if (!openaiApiKey) {
    throw new Error("OpenAI API key is not configured. Add it in Settings or set OPENAI_API_KEY in .env.");
  }

  const intake = lead.leadIntakes[0];
  const latestConversationThread = lead.threads.find((thread) => thread.emails.some((email) => email.direction === "INBOUND")) || lead.threads[0];
  let latestInbound = lead.threads
    .flatMap((thread) => thread.emails.map((email) => ({ ...email, threadId: thread.id, threadSubject: thread.subject })))
    .filter((email) => email.direction === "INBOUND")
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
  const allLeadEmails = lead.threads
    .flatMap((thread) => thread.emails.map((email) => ({ ...email, threadId: thread.id })))
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const latestLeadEmail = allLeadEmails.at(-1);
  const latestLeadOutbound = [...allLeadEmails].reverse().find((email) => email.direction === "OUTBOUND");
  const hasClientReplyAfterLastOutbound = Boolean(latestLeadOutbound && latestInbound && latestInbound.sentAt > latestLeadOutbound.sentAt);
  const requestedActionType = extractActionType(lead.notes);
  const isRevival = requestedActionType === "REVIVAL" || isRevivalLead(intake?.receivedAt || lead.createdAt);
  const isForwardedWarmReply = intake?.replyMode === "continue_existing_conversation" && Boolean(intake.latestClientMessage || intake.originalConversationText || intake.fullForwardedChain);
  if (isRevival && hasDoNotContactMarker([lead.notes, intake?.rawText, intake?.originalClientMessage, intake?.forwardedClientMessage].join("\n"))) {
    throw new Error("Revival blocked because this lead contains unsubscribe, bounce, stop, or not interested markers.");
  }
  if (!isForwardedWarmReply && latestLeadOutbound && latestLeadEmail?.direction === "OUTBOUND" && !hasClientReplyAfterLastOutbound) {
    return generateReplyDraft(latestLeadOutbound.threadId, "FOLLOWUP");
  }
  if (!isForwardedWarmReply && latestLeadOutbound && latestLeadEmail?.direction === "INBOUND") {
    return generateReplyDraft(latestLeadEmail.threadId, "REPLY");
  }
  const intelligence = buildLeadIntelligence(lead);
  const originalClientMessage = latestInbound?.textBody || latestInbound?.snippet || intake?.latestClientMessage || intake?.originalClientMessage || intake?.forwardedClientMessage || lead.notes || "";
  if (!originalClientMessage.trim()) {
    throw new Error("Cannot generate a draft because no client message or thread context is available. Please write a manual reply.");
  }
  const retrievalQuery = [
    lead.name,
    lead.email,
    lead.company,
    lead.website,
    lead.country,
    lead.service,
    originalClientMessage
  ].filter(Boolean).join(" ").slice(0, 8000);
  const [knowledge, editLearnings, exampleObjects] = await Promise.all([
    retrieveKnowledgeContext(retrievalQuery, "REPLY", openaiApiKey),
    retrieveEditLearnings(),
    retrievePreviousExampleObjects(retrievalQuery, "REPLY", lead.country)
  ]);

  const generated = await generateSalesEmailWithFallback({
    emailType: isForwardedWarmReply ? "REPLY" : isRevival ? "REVIVAL" : "FIRST_REPLY",
    lead: {
      name: lead.name,
      email: lead.email,
      company: lead.company,
      website: lead.website,
      country: lead.country,
      service: lead.service,
      timezone: intelligence.detectedTimezone,
      currentLocalTime: intelligence.currentLocalTime,
      bestSendRecommendation: intelligence.sendNowRecommendation,
      suggestedEmailAngle: intelligence.suggestedEmailAngle,
      replyProbability: intelligence.replyProbability,
      status: lead.status,
      clientEmailConfidence: lead.clientEmailConfidence,
      qualification: lead.qualification
        ? {
            score: lead.qualification.score,
            classification: lead.qualification.classification,
            winProbability: lead.qualification.winProbability,
            recommendedAction: lead.qualification.recommendedAction
          }
        : null,
      clientBrain: describeClientBrain(lead.clientBrain),
      sourceFolder: intake?.sourceFolderPath || intake?.sourceFolder,
      sourceProviderName: intake?.sourceProviderName || intake?.detectedProviderName,
      leadSourceType: intake?.leadSourceType,
      conversationType: intake?.conversationType,
      replyMode: intake?.replyMode,
      originalClientName: intake?.originalClientName,
      originalClientEmail: intake?.originalClientEmail,
      latestClientMessage: intake?.latestClientMessage,
      detectedIntent: intake?.detectedIntent,
      requestedItems: intake?.requestedItems,
      recommendedReplyType: intake?.recommendedReplyType
    },
    threadMessages: [{
      direction: "INBOUND",
      from: lead.email,
      to: ["abhay@aresourcepool.com"],
      subject: latestInbound?.subject || intake?.subject || `Inquiry from ${lead.name || lead.email}`,
      sentAt: latestInbound?.sentAt.toISOString() || intake?.receivedAt.toISOString() || new Date().toISOString(),
      body: truncate(originalClientMessage || intake?.rawText || "", 3000)
    }],
    knowledgeContext: [
      knowledge || "No matching knowledge base items found.",
      "",
      "User edit learning:",
      editLearnings || "No edit learnings captured yet.",
      "",
      "First reply rules:",
      "Write as Abhay Kumar, Sales & Marketing Director at AResourcePool.",
      "Use only the client requirement and extracted lead details.",
      "Do not mention forwarded lead chain, lead provider, Sandip, internal team, or email parsing.",
      isRevival
        ? "REVIVAL rules: Generate a fresh reconnect email. Do not say \"Thank you for your reply\", \"Just following up\", or \"As per my last email\". Use soft reconnect language like \"We connected some time ago\" or \"I wanted to reconnect briefly\". Keep it short and ask one simple next step."
        : "",
      `Timing intelligence: client local time is ${intelligence.currentLocalTime}; recommendation is ${intelligence.sendNowRecommendation}; next best send time is ${intelligence.nextBestSendTime}.`,
      `Suggested email angle: ${intelligence.suggestedEmailAngle}`,
      "",
      "Client brain:",
      describeClientBrain(lead.clientBrain) || "No client brain has been saved yet.",
      "",
      "Forwarded lead context:",
      intake?.fullForwardedChain || intake?.originalConversationText
        ? [
            `Lead source type: ${intake.leadSourceType || "forwarded_provider_lead"}`,
            `Conversation type: ${intake.conversationType || "warm_reply"}`,
            `Reply mode: ${intake.replyMode || "continue_existing_conversation"}`,
            `Original client: ${intake.originalClientName || lead.name || "n/a"} <${intake.originalClientEmail || lead.email}>`,
            `Original subject: ${intake.originalSubject || latestInbound?.subject || intake.subject || "n/a"}`,
            `Latest client message: ${truncate(intake.latestClientMessage || originalClientMessage, 2500)}`,
            `Detected intent: ${intake.detectedIntent || "UNKNOWN"}`,
            `Requested items: ${Array.isArray(intake.requestedItems) && intake.requestedItems.length ? intake.requestedItems.join(", ") : "None detected"}`,
            `Recommended reply type: ${intake.recommendedReplyType || "Context-aware reply"}`,
            `Previous provider messages: ${truncate(intake.previousProviderMessages || "", 1200)}`,
            `Forwarded chain summary: ${truncate(intake.originalConversationText || intake.fullForwardedChain || "", 2000)}`
          ].join("\n")
        : "No forwarded conversation context detected.",
      "If forwarded context exists, treat this as a warm conversation reply from Abhay, not cold outreach. Answer the latest client question directly.",
      "Never include forwarded headers, provider names, internal metadata, parsing details, or phrases like \"we received your lead from\".",
      "Do not say the email has already been sent."
    ].join("\n"),
    previousApprovedExamples: exampleObjects,
    userInstruction: [
      "LATEST CLIENT MESSAGE:",
      truncate(originalClientMessage, 3000),
      "",
      `Detected intent: ${intake?.detectedIntent || "UNKNOWN"}`,
      `Requested items: ${Array.isArray(intake?.requestedItems) ? intake.requestedItems.join(", ") : "n/a"}`,
      `Recommended reply: ${intake?.recommendedReplyType || "n/a"}`,
      `Lead source type: ${intake?.leadSourceType || "n/a"}`,
      `Conversation type: ${intake?.conversationType || "n/a"}`,
      `Reply mode: ${intake?.replyMode || "n/a"}`,
      "If the client asked pricing, portfolio, examples, mockup, or timeline, answer those points directly.",
      "If reply mode is continue_existing_conversation, continue naturally as Abhay without mentioning provider forwarding.",
      "",
      `Original client message: ${truncate(originalClientMessage, 3000)}`,
      `Website: ${lead.website || "n/a"}`,
      `Phone: ${lead.phone || "n/a"}`,
      `Service: ${lead.service || "n/a"}`,
      `Country: ${lead.country || "n/a"}`,
      `Client local time: ${intelligence.currentLocalTime}`,
      `Best send recommendation: ${intelligence.sendNowRecommendation}`,
      `Suggested approach: ${intelligence.suggestedEmailAngle}`,
      `Reply probability: ${intelligence.replyProbability}`,
      `Client brain: ${describeClientBrain(lead.clientBrain) || "n/a"}`,
      isForwardedWarmReply
        ? "Generate an approval-ready warm conversation reply as Abhay."
        : isRevival ? "Generate an approval-ready fresh reconnect/revival email." : "Generate an approval-ready first sales reply."
    ].join("\n")
  }, {
    apiKey: openaiApiKey,
    model: MODEL,
    feature: "DRAFT_GENERATION",
    leadId: lead.id
  });

  const subject = generated.subject || buildFirstReplySubject(lead.service);
  const body = ensureDraftBody(generated, {
    leadName: lead.name,
    service: lead.service,
    emailType: isRevival ? "REVIVAL" : "FIRST_REPLY",
    latestClientMessage: originalClientMessage
  });

  const thread = latestConversationThread
    ? await prisma.emailThread.update({
        where: { id: latestConversationThread.id },
        data: {
          leadId: lead.id,
          subject: latestInbound?.subject || latestConversationThread.subject || subject,
          lastMessageAt: latestInbound?.sentAt || latestConversationThread.lastMessageAt
        }
      })
    : await prisma.emailThread.upsert({
        where: {
          accountId_normalizedKey: {
            accountId: account.id,
            normalizedKey: `lead-first-reply:${lead.id}`
          }
        },
        create: {
          accountId: account.id,
          leadId: lead.id,
          subject,
          normalizedKey: `lead-first-reply:${lead.id}`,
          lastMessageAt: intake?.receivedAt || new Date()
        },
        update: {
          leadId: lead.id,
          subject
        }
      });
  if (isForwardedWarmReply && intake && !latestInbound) {
    const syntheticInbound = await ensureForwardedLeadInboundEmail({
      accountId: account.id,
      threadId: thread.id,
      leadId: lead.id,
      intake,
      fallbackSubject: subject,
      fallbackBody: originalClientMessage,
      toEmail: account.emailAddress
    });
    latestInbound = { ...syntheticInbound, threadId: thread.id, threadSubject: thread.subject };
  }

  const draft = await prisma.$transaction(async (tx) => {
    await tx.draft.updateMany({
      where: {
        threadId: thread.id,
        draftType: "REPLY",
        status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] },
        isCurrent: true
      },
      data: { isCurrent: false, supersededAt: new Date() }
    });
    const latestVersion = await tx.draft.findFirst({
      where: { threadId: thread.id, draftType: "REPLY" },
      orderBy: { draftVersion: "desc" },
      select: { draftVersion: true }
    });
    const created = await tx.draft.create({
      data: {
        threadId: thread.id,
        sourceEmailId: latestInbound?.id,
        basedOnEmailId: latestInbound?.id,
        basedOnMessageId: latestInbound?.messageId,
        basedOnEmailDate: latestInbound?.sentAt || intake?.receivedAt || new Date(),
        draftVersion: (latestVersion?.draftVersion || 0) + 1,
        isCurrent: true,
        toEmails: [lead.email],
        subject,
        body,
        draftType: "REPLY",
        aiModel: MODEL,
        promptVersion: generated.fallbackDraft ? `${PROMPT_VERSION}-first-reply-fallback` : `${PROMPT_VERSION}-first-reply`,
        confidence: generated.confidence || 0.8,
        trackingEnabled: true
      }
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: "DRAFT_CREATED",
        timezone: intelligence.detectedTimezone,
        timezoneConfidence: intelligence.timezoneConfidence,
        bestSendTime: new Date(intelligence.nextBestSendTimeIso),
        lastRecommendedSendTime: new Date(),
        suggestedEmailAngle: intelligence.suggestedEmailAngle,
        replyProbability: intelligence.replyProbability,
        intelligenceUpdatedAt: new Date()
      }
    });
    return created;
  });

  await logActivity({
    type: "DRAFT_GENERATED",
    message: `First reply draft generated for ${lead.email}`,
    leadId: lead.id,
    threadId: thread.id,
    metadata: {
      draftId: draft.id,
      model: MODEL,
      promptVersion: generated.fallbackDraft ? `${PROMPT_VERSION}-first-reply-fallback` : `${PROMPT_VERSION}-first-reply`,
      suggestedStatus: generated.suggested_status,
      nextAction: generated.next_action,
      fallbackDraft: Boolean(generated.fallbackDraft)
    }
  });

  return draft;
}

async function ensureForwardedLeadInboundEmail(input: {
  accountId: string;
  threadId: string;
  leadId: string;
  intake: {
    id: string;
    receivedAt: Date;
    subject: string;
    originalSubject: string | null;
    originalClientName: string | null;
    originalClientEmail: string | null;
    extractedName: string | null;
    extractedClientEmail: string | null;
    latestClientMessage: string | null;
    originalClientMessage: string | null;
    previousProviderMessages: string | null;
    originalConversationText: string | null;
    fullForwardedChain: string | null;
    sourceFolder: string | null;
    sourceFolderPath: string | null;
    sourceProviderName: string | null;
    detectedProviderName: string | null;
    providerEmail: string | null;
    leadGeneratorEmail: string | null;
    fromEmail: string;
  };
  fallbackSubject: string;
  fallbackBody: string;
  toEmail: string;
}) {
  const messageId = `<lead-intake-${input.intake.id}@ai-sales-os.local>`;
  const existing = await prisma.email.findUnique({ where: { messageId } });
  if (existing) return existing;

  const subject = input.intake.originalSubject || input.intake.subject || input.fallbackSubject;
  const body = buildCleanForwardedConversationBody(input.intake, input.fallbackBody);
  const created = await prisma.email.create({
    data: {
      accountId: input.accountId,
      threadId: input.threadId,
      direction: "INBOUND",
      messageId,
      fromName: input.intake.originalClientName || input.intake.extractedName,
      fromEmail: input.intake.originalClientEmail || input.intake.extractedClientEmail || "",
      toEmails: [input.toEmail],
      folder: input.intake.sourceFolder || "Lead Intake",
      sourceFolder: input.intake.sourceFolder,
      sourceFolderPath: input.intake.sourceFolderPath,
      sourceProviderName: input.intake.sourceProviderName || input.intake.detectedProviderName || input.intake.providerEmail || input.intake.leadGeneratorEmail || input.intake.fromEmail,
      subject,
      normalizedSubject: normalizeSubject(subject),
      snippet: body.replace(/\s+/g, " ").slice(0, 220),
      textBody: body,
      htmlBody: null,
      sentAt: input.intake.receivedAt || new Date(),
      receivedAt: input.intake.receivedAt || new Date()
    }
  });

  await prisma.$transaction([
    prisma.emailThread.update({
      where: { id: input.threadId },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: created.sentAt
      }
    }),
    prisma.lead.update({
      where: { id: input.leadId },
      data: {
        lastInboundAt: created.sentAt,
        status: "NEEDS_REPLY",
        waitingForReply: false
      }
    })
  ]);

  return created;
}

function buildCleanForwardedConversationBody(
  intake: {
    latestClientMessage: string | null;
    originalClientMessage: string | null;
    previousProviderMessages: string | null;
    originalConversationText: string | null;
    fullForwardedChain: string | null;
  },
  fallbackBody: string
) {
  const latestClientReply = intake.latestClientMessage || intake.originalClientMessage || fallbackBody || "";
  const previousConversation = intake.previousProviderMessages
    || cleanForwardedConversationText(intake.originalConversationText || intake.fullForwardedChain || "");
  const sections = [
    latestClientReply
      ? ["Latest client reply:", latestClientReply.trim()].join("\n")
      : "",
    previousConversation
      ? ["Previous outreach / conversation:", previousConversation.trim()].join("\n")
      : ""
  ].filter(Boolean);
  return sections.join("\n\n").slice(0, 9000);
}

function cleanForwardedConversationText(value: string) {
  return (value || "")
    .replace(/^\s*(from|date|subject|to|cc|bcc)\s*:.*$/gim, "")
    .replace(/-{2,}\s*forwarded message\s*-{2,}/gi, "")
    .replace(/begin forwarded message:/gi, "")
    .replace(/original message/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6000);
}

export async function generateReplyDraft(threadId: string, draftType: DraftKind = "REPLY") {
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: {
      lead: { include: { clientBrain: true, qualification: true } },
      emails: { orderBy: { sentAt: "asc" } }
    }
  });
  if (!thread) throw new Error("Thread not found");
  if (!thread.lead) throw new Error("Thread has no lead");
  const lead = thread.lead;
  if (!lead.email) throw new Error("Cannot generate a draft because the recipient email is missing.");
  const account = await getActiveAccount();
  const { openaiApiKey } = accountSecrets(account);
  if (!openaiApiKey) {
    throw new Error("OpenAI API key is not configured. Add it in Settings or set OPENAI_API_KEY in .env.");
  }

  const latestOutbound = [...thread.emails].reverse().find((email) => email.direction === "OUTBOUND");
  const latestInbound = [...thread.emails].reverse().find((email) => email.direction === "INBOUND");
  const latestMessage = thread.emails.at(-1);
  const hasClientReplyAfterLastOutbound = Boolean(latestOutbound && latestInbound && latestInbound.sentAt > latestOutbound.sentAt);
  const requestedActionType = extractActionType(thread.lead.notes);
  const isRevival = requestedActionType === "REVIVAL" || isRevivalLead(thread.lead.createdAt);
  if (isRevival && hasDoNotContactMarker([thread.lead.notes, ...thread.emails.map((email) => `${email.subject}\n${email.textBody || email.snippet || ""}`)].join("\n"))) {
    throw new Error("Revival blocked because this lead contains unsubscribe, bounce, stop, or not interested markers.");
  }
  const effectiveDraftType: DraftKind = isRevival
    ? "REPLY"
    : latestOutbound && latestMessage?.direction === "OUTBOUND" && !hasClientReplyAfterLastOutbound
    ? "FOLLOWUP"
    : "REPLY";
  const emailType: EmailGenerationType | "REVIVAL" = isRevival ? "REVIVAL" : effectiveDraftType === "FOLLOWUP" ? "FOLLOW_UP" : "REPLY";
  const contextText = effectiveDraftType === "FOLLOWUP"
    ? latestOutbound?.textBody || latestOutbound?.snippet || ""
    : latestInbound?.textBody || latestInbound?.snippet || "";
  if (!contextText.trim() && !thread.subject.trim()) {
    throw new Error("Cannot generate a draft because no latest client message or thread context is available. Please write a manual reply.");
  }
  const daysSinceLastSent = latestOutbound ? Math.max(0, Math.floor((Date.now() - latestOutbound.sentAt.getTime()) / 86_400_000)) : null;

  const retrievalQuery = [
    thread.subject,
    thread.lead.company,
    thread.lead.email,
    thread.lead.website,
    thread.lead.country,
    thread.lead.service,
    thread.lead.notes,
    effectiveDraftType,
    ...thread.emails.map((email) => `${email.subject} ${email.textBody || email.snippet || ""}`)
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 8000);
  const leadCountry = extractLeadMetadata(thread.lead.notes, "country");
  const [knowledge, editLearnings, exampleObjects] = await Promise.all([
    retrieveKnowledgeContext(retrievalQuery, effectiveDraftType, openaiApiKey),
    retrieveEditLearnings(),
    retrievePreviousExampleObjects(retrievalQuery, effectiveDraftType, leadCountry)
  ]);

  const followupStage = effectiveDraftType === "FOLLOWUP" ? Math.max(thread.lead.followupStage || 1, 1) : undefined;
  const intelligence = buildLeadIntelligence(thread.lead);

  if (effectiveDraftType === "FOLLOWUP") {
    const existingDraft = await prisma.draft.findFirst({
      where: {
        threadId,
        draftType: "FOLLOWUP",
        followupStage,
        isCurrent: true,
        status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] }
      },
      orderBy: { createdAt: "desc" }
    });
    if (existingDraft) {
      const scheduled = existingDraft.status === "SCHEDULED"
        ? await prisma.scheduledEmail.findFirst({
            where: { draftId: existingDraft.id, status: { in: ["SCHEDULED", "SENDING"] } },
            orderBy: { scheduledAt: "desc" }
          })
        : null;
      await prisma.lead.update({
        where: { id: thread.lead.id },
        data: {
          status: "DRAFT_CREATED",
          followupState: existingDraft.status === "SCHEDULED" ? FOLLOWUP_STATES.SCHEDULED : FOLLOWUP_STATES.DRAFT_CREATED,
          followupStateUpdatedAt: new Date(),
          followupDraftId: existingDraft.id,
          followupScheduledEmailId: scheduled?.id || null
        }
      });
      return existingDraft;
    }
  }

  const generated = await generateSalesEmailWithFallback({
    emailType,
    lead: {
      name: thread.lead.name,
      email: thread.lead.email,
      company: thread.lead.company,
      website: thread.lead.website,
      country: thread.lead.country,
      service: thread.lead.service,
      status: thread.lead.status,
      followupStage,
      timezone: intelligence.detectedTimezone,
      currentLocalTime: intelligence.currentLocalTime,
      bestSendRecommendation: intelligence.sendNowRecommendation,
      suggestedEmailAngle: intelligence.suggestedEmailAngle,
      replyProbability: intelligence.replyProbability,
      qualification: thread.lead.qualification
        ? {
            score: thread.lead.qualification.score,
            classification: thread.lead.qualification.classification,
            winProbability: thread.lead.qualification.winProbability,
            recommendedAction: thread.lead.qualification.recommendedAction
          }
        : null,
      clientBrain: describeClientBrain(thread.lead.clientBrain),
      latestMessageDirection: latestMessage?.direction || null,
      lastInboundAt: latestInbound?.sentAt.toISOString() || thread.lead.lastInboundAt?.toISOString() || null,
      lastOutboundAt: latestOutbound?.sentAt.toISOString() || thread.lead.lastOutboundAt?.toISOString() || null,
      latestOutboundAt: latestOutbound?.sentAt.toISOString(),
      daysSinceLastSent,
      hasClientReplyAfterLastOutbound
    },
    threadMessages: thread.emails.map((email) => ({
      direction: email.direction,
      from: email.fromEmail,
      to: email.toEmails,
      subject: email.subject,
      sentAt: email.sentAt.toISOString(),
      body: truncate(email.textBody || email.snippet || "", 2500)
    })),
    knowledgeContext: [
      knowledge || "No matching knowledge base items found.",
      "",
      "User edit learning:",
      editLearnings || "No edit learnings captured yet.",
      "",
      "Additional follow-up instruction:",
      isRevival
        ? [
            "This is a REVIVAL email for an old dormant lead.",
            "Generate a fresh reconnect email.",
            "Do not say \"Thank you for your reply\", \"Just following up\", or \"As per my last email\".",
            "Use soft reconnect language such as \"We connected some time ago\" or \"I wanted to reconnect briefly\".",
            "Keep it short and ask one simple next step."
          ].join(" ")
        : effectiveDraftType === "FOLLOWUP"
        ? [
            "This is a FOLLOW-UP because the latest message is outbound and there is no later client reply.",
            "Do not write as if the client replied.",
            "Never say \"Thank you for your reply\" or \"Thank you for the update\".",
            "Acknowledge previous outreach lightly, keep it short, mention only 1-2 relevant points, and use a soft CTA.",
            "Do not repeat a full MVP explanation or long feature list unless the client asked for it."
          ].join(" ")
        : "This is a direct reply to an inbound lead email.",
      "",
      effectiveDraftType === "REPLY" && latestInbound
        ? [
            "LATEST CLIENT MESSAGE:",
            truncate(latestInbound.textBody || latestInbound.snippet || "", 2500),
            `Latest client message date: ${latestInbound.sentAt.toISOString()}`,
            ""
          ].join("\n")
        : "",
      "",
      effectiveDraftType === "FOLLOWUP" && latestOutbound
        ? [
            "LAST SENT EMAIL TO FOLLOW UP ON:",
            truncate(latestOutbound.textBody || latestOutbound.snippet || "", 2500),
            `Last sent email date: ${latestOutbound.sentAt.toISOString()}`,
            ""
          ].join("\n")
        : "",
      "",
      "Lead intelligence:",
      `Client local time: ${intelligence.currentLocalTime}`,
      `Send recommendation: ${intelligence.sendNowRecommendation}`,
      `Suggested angle: ${intelligence.suggestedEmailAngle}`,
      `Reply probability: ${intelligence.replyProbability}`,
      "",
      "Client brain:",
      describeClientBrain(thread.lead.clientBrain) || "No client brain has been saved yet."
    ].join("\n"),
    previousApprovedExamples: exampleObjects,
    userInstruction: [
      `Email Type: ${emailType}`,
      `Latest message direction: ${latestMessage?.direction || "n/a"}`,
      `Client reply after last sent: ${hasClientReplyAfterLastOutbound ? "Yes" : "No"}`,
      `Days since last sent: ${daysSinceLastSent ?? "n/a"}`,
      effectiveDraftType === "FOLLOWUP"
        ? `LAST SENT EMAIL TO FOLLOW UP ON:\n${truncate(latestOutbound?.textBody || latestOutbound?.snippet || "", 2500)}`
        : latestInbound ? `LATEST CLIENT MESSAGE:\n${truncate(latestInbound.textBody || latestInbound.snippet || "", 2500)}` : "LATEST CLIENT MESSAGE: n/a",
      latestInbound ? `Latest client message date: ${latestInbound.sentAt.toISOString()}` : "Latest client message date: n/a",
      `Thread subject: ${thread.subject}`,
      `Follow-up stage: ${followupStage || "n/a"}`,
      `Latest sent email date: ${latestOutbound?.sentAt.toISOString() || "n/a"}`,
      `Website: ${thread.lead.website || "n/a"}`,
      `Country: ${thread.lead.country || "n/a"}`,
      `Service: ${thread.lead.service || "n/a"}`,
      `Client brain: ${describeClientBrain(thread.lead.clientBrain) || "n/a"}`,
      isRevival
        ? "Generate a short fresh reconnect/revival email. Do not mention following up or imply there was a recent reply."
        : effectiveDraftType === "FOLLOWUP"
        ? "Generate a short follow-up email. Do not imply the client replied. Do not use thank-you-for-your-reply/update language."
        : "Return an approval-ready reply draft. Do not say it has been sent."
    ].join("\n")
  }, {
    apiKey: openaiApiKey,
    model: MODEL,
    feature: effectiveDraftType === "FOLLOWUP" ? "FOLLOW_UP_GENERATION" : "DRAFT_GENERATION",
    leadId: thread.lead.id
  });

  const body = sanitizeGeneratedBody(ensureDraftBody(generated, {
    leadName: thread.lead.name,
    service: thread.lead.service,
    emailType,
    latestClientMessage: contextText
  }), {
    emailType: emailType === "REVIVAL" ? "FOLLOW_UP" : emailType,
    latestMessageDirection: latestMessage?.direction || null
  });

  const draft = await prisma.$transaction(async (tx) => {
    await tx.draft.updateMany({
      where: {
        threadId,
        draftType: effectiveDraftType,
        ...(effectiveDraftType === "FOLLOWUP" ? { followupStage } : {}),
        status: { in: ["DRAFT", "APPROVED", "SCHEDULED"] },
        isCurrent: true
      },
      data: { isCurrent: false, supersededAt: new Date() }
    });
    const latestVersion = await tx.draft.findFirst({
      where: { threadId, draftType: effectiveDraftType, ...(effectiveDraftType === "FOLLOWUP" ? { followupStage } : {}) },
      orderBy: { draftVersion: "desc" },
      select: { draftVersion: true }
    });
    const created = await tx.draft.create({
      data: {
        threadId,
        toEmails: [lead.email],
        sourceEmailId: effectiveDraftType === "FOLLOWUP" ? latestOutbound?.id : latestInbound?.id,
        basedOnEmailId: effectiveDraftType === "FOLLOWUP" ? latestOutbound?.id : latestInbound?.id,
        basedOnMessageId: (effectiveDraftType === "FOLLOWUP" ? latestOutbound?.messageId : latestInbound?.messageId) || null,
        basedOnEmailDate: (effectiveDraftType === "FOLLOWUP" ? latestOutbound?.sentAt : latestInbound?.sentAt) || null,
        draftVersion: (latestVersion?.draftVersion || 0) + 1,
        isCurrent: true,
        subject: generated.subject || (thread.subject.toLowerCase().startsWith("re:") ? thread.subject : `Re: ${thread.subject}`),
        body,
        draftType: effectiveDraftType,
        followupStage,
        aiModel: MODEL,
        promptVersion: generated.fallbackDraft ? `${PROMPT_VERSION}-fallback` : PROMPT_VERSION,
        confidence: generated.confidence || 0.8
      }
    });
    await tx.lead.update({
      where: { id: thread.lead!.id },
      data: {
        status: "DRAFT_CREATED",
        followupStage: followupStage || thread.lead!.followupStage,
        ...(effectiveDraftType === "FOLLOWUP"
          ? {
              followupState: FOLLOWUP_STATES.DRAFT_CREATED,
              followupStateUpdatedAt: new Date(),
              followupDraftId: created.id,
              followupScheduledEmailId: null
            }
          : {})
      }
    });
    return created;
  });

  await logActivity({
    type: "DRAFT_GENERATED",
    message: `AI ${effectiveDraftType.toLowerCase()} draft generated for ${thread.lead.email}`,
    leadId: thread.lead.id,
    threadId,
    metadata: {
      draftId: draft.id,
      model: MODEL,
      promptVersion: generated.fallbackDraft ? `${PROMPT_VERSION}-fallback` : PROMPT_VERSION,
      suggestedStatus: generated.suggested_status,
      nextAction: generated.next_action,
      fallbackDraft: Boolean(generated.fallbackDraft)
    }
  });

  return draft;
}

function buildFirstReplySubject(service: string | null) {
  return service ? `Re: ${service} inquiry` : "Re: Your project inquiry";
}

async function generateSalesEmailWithFallback(
  input: GenerateSalesEmailInput,
  options: NonNullable<Parameters<typeof generateSalesEmail>[1]>
): Promise<GeneratedSalesEmail> {
  try {
    const generated = await generateSalesEmail(input, options);
    if (String(generated.body || "").trim()) return generated;
    console.warn("[AI draft fallback]", {
      model: options.model || MODEL,
      feature: options.feature || "DRAFT_GENERATION",
      leadId: options.leadId || null,
      reason: "AI returned no usable text."
    });
    return buildFallbackGeneratedEmail(input, "AI returned no usable text.");
  } catch (error) {
    console.warn("[AI draft fallback]", {
      model: options.model || MODEL,
      feature: options.feature || "DRAFT_GENERATION",
      leadId: options.leadId || null,
      reason: error instanceof Error ? error.message : String(error)
    });
    return buildFallbackGeneratedEmail(input, error instanceof Error ? error.message : "AI call failed.");
  }
}

function ensureDraftBody(
  generated: GeneratedSalesEmail,
  context: { leadName?: string | null; service?: string | null; emailType: string; latestClientMessage?: string | null }
) {
  const body = String(generated.body || "").trim();
  if (body) return body;
  return buildFallbackBody({
    leadName: context.leadName,
    service: context.service,
    emailType: context.emailType,
    latestClientMessage: context.latestClientMessage
  });
}

function buildFallbackGeneratedEmail(input: GenerateSalesEmailInput, reason: string): GeneratedSalesEmail {
  const lead = input.lead || {};
  return {
    subject: fallbackSubject(input),
    body: buildFallbackBody({
      leadName: typeof lead.name === "string" ? lead.name : null,
      service: typeof lead.service === "string" ? lead.service : null,
      emailType: String(input.emailType || "REPLY"),
      latestClientMessage: latestContextText(input)
    }),
    confidence: 0.35,
    suggested_status: "DRAFT_CREATED",
    next_action: `Fallback draft created because ${reason} Please review manually.`,
    fallbackDraft: true
  };
}

function fallbackSubject(input: GenerateSalesEmailInput) {
  const threadSubject = input.threadMessages?.map((message) => String(message.subject || "")).find(Boolean);
  if (threadSubject) return threadSubject.toLowerCase().startsWith("re:") ? threadSubject : `Re: ${threadSubject}`;
  const service = typeof input.lead?.service === "string" ? input.lead.service : "";
  return service ? `Re: ${service} inquiry` : "Re: Your message";
}

function latestContextText(input: GenerateSalesEmailInput) {
  const latest = input.threadMessages?.at(-1);
  return String(latest?.body || input.userInstruction || "").trim();
}

function buildFallbackBody(input: { leadName?: string | null; service?: string | null; emailType: string; latestClientMessage?: string | null }) {
  const name = input.leadName?.trim() || "there";
  const serviceLine = input.service ? ` regarding ${input.service}` : "";
  const lowerType = input.emailType.toLowerCase();
  if (lowerType.includes("follow") || lowerType.includes("revival")) {
    return [
      `Hi ${name},`,
      "",
      `I wanted to reconnect briefly${serviceLine}.`,
      "",
      "If this is still relevant, we can certainly help you review the requirement and suggest a practical next step.",
      "",
      "Would it be useful if I shared a short approach or rough estimate?",
      "",
      "Best regards,",
      "Abhay Kumar"
    ].join("\n");
  }
  return [
    `Hi ${name},`,
    "",
    "Thank you for your message.",
    "",
    `We can certainly help${serviceLine}. To suggest the right next step, could you please share any key goals, timeline, and budget range you have in mind?`,
    "",
    "Once I have that, I can recommend a practical approach.",
    "",
    "Best regards,",
    "Abhay Kumar"
  ].join("\n");
}

function sanitizeGeneratedBody(body: string, context: { emailType: EmailGenerationType; latestMessageDirection: string | null }) {
  if (context.emailType !== "FOLLOW_UP" || context.latestMessageDirection === "INBOUND") return body;
  return body
    .replace(/thank you for (your|the) reply[,.! ]*/gi, "")
    .replace(/thanks for (your|the) reply[,.! ]*/gi, "")
    .replace(/thank you for (your|the) update[,.! ]*/gi, "")
    .replace(/thanks for (your|the) update[,.! ]*/gi, "")
    .replace(/\byes,\s+we can help[,.! ]*/gi, "We can help ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractActionType(notes?: string | null) {
  return notes?.match(/\[AI_SALES_ACTION_TYPE:(FIRST_REPLY|FOLLOW_UP|REVIVAL)\]/)?.[1] || null;
}

function isRevivalLead(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000) >= 731;
}

function hasDoNotContactMarker(text: string) {
  return /\b(unsubscribe|stop emailing|do not contact|don't contact|not interested|delivery failed|undeliverable|bounce|mailer-daemon)\b/i.test(text);
}

async function retrievePreviousExampleObjects(
  query: string,
  draftType: DraftKind,
  clientCountry: string | null
) {
  const approvedExamples = await prisma.approvedEmailExample.findMany({
    where: { emailType: draftType },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const queryTerms = tokenSet(query);
  const serviceTypes = detectServiceTypes(query);
  const approvedMatches = approvedExamples
    .map((example) => ({
      example,
      score:
        scoreText(`${example.leadIndustry || ""} ${example.clientCountry || ""}`, queryTerms) +
        scoreText(example.userFinalSentEmail, queryTerms) +
        scoreServiceType(example, serviceTypes) +
        scoreCountry(example.clientCountry, clientCountry)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ example }) => ({
      emailType: example.emailType,
      leadIndustry: example.leadIndustry,
      clientCountry: example.clientCountry,
      matchedServiceTypes: detectServiceTypes(
        `${example.leadIndustry || ""} ${example.aiOriginalDraft} ${example.userFinalSentEmail}`
      ),
      aiOriginalDraft: truncate(example.aiOriginalDraft, 700),
      userFinalSentEmail: truncate(example.userFinalSentEmail, 900),
      editDifference: example.editDifference
    }));
  return approvedMatches;
}

async function retrieveKnowledge(query: string, draftType: DraftKind) {
  const items = await prisma.aiKnowledgeItem.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" }
  });
  const queryTerms = tokenSet(`${query} ${draftType}`);
  return items
    .map((item) => ({
      item,
      score:
        scoreText(item.title, queryTerms) +
        scoreText(item.category, queryTerms) +
        scoreText(item.content, queryTerms) +
        item.keywords.reduce((sum, keyword) => sum + (queryTerms.has(keyword.toLowerCase()) ? 3 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score)
    .filter(({ score }) => score > 0)
    .slice(0, 5)
    .map(({ item }) => `- ${item.title} (${item.category}): ${item.content}`)
    .join("\n");
}

async function retrieveKnowledgeContext(query: string, draftType: DraftKind, openaiApiKey: string) {
  if (process.env.AI_VECTOR_RETRIEVAL !== "true") {
    return retrieveKnowledge(query, draftType);
  }
  try {
    const vectorContext = await retrieveVectorKnowledge(`${query} ${draftType}`, openaiApiKey, 3);
    if (vectorContext) return vectorContext;
  } catch (error) {
    await logActivity({
      type: "ERROR",
      message: "Vector knowledge retrieval failed; falling back to keyword retrieval",
      metadata: { error: error instanceof Error ? error.message : String(error) }
    });
  }
  return retrieveKnowledge(query, draftType);
}

async function retrieveEditLearnings() {
  const edits = await prisma.draftEdit.findMany({
    orderBy: { createdAt: "desc" },
    take: 8
  });
  return edits
    .map((edit, index) =>
      [
        `Edit ${index + 1}: ${edit.editSummary || "User edited draft."}`,
        `Before: ${truncate(edit.beforeBody, 350)}`,
        `After: ${truncate(edit.afterBody, 350)}`
      ].join("\n")
    )
    .join("\n\n");
}

function truncate(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
}

function scoreText(value: string, queryTerms: Set<string>) {
  const terms = tokenSet(value);
  let score = 0;
  for (const term of terms) {
    if (queryTerms.has(term)) score += 1;
  }
  return score;
}

function detectServiceTypes(value: string) {
  const text = value.toLowerCase();
  const matches: string[] = [];
  const services = [
    { type: "website", patterns: ["website", "web design", "redesign", "wordpress", "shopify", "woocommerce", "webflow", "wix"] },
    { type: "app", patterns: ["mobile app", "android", "ios", "react native", "flutter", "app development"] },
    { type: "AI", patterns: [" ai ", "artificial intelligence", "automation", "agent", "chatbot", "openai"] },
    { type: "SEO", patterns: ["seo", "search engine", "digital marketing", "ranking", "traffic"] },
    { type: "CRM", patterns: ["crm", "hubspot", "salesforce", "pipeline", "integration"] }
  ];

  for (const service of services) {
    if (service.patterns.some((pattern) => text.includes(pattern))) {
      matches.push(service.type);
    }
  }
  return matches;
}

function scoreServiceType(
  example: { leadIndustry: string | null; aiOriginalDraft: string; userFinalSentEmail: string },
  serviceTypes: string[]
) {
  if (serviceTypes.length === 0) return 0;
  const exampleServiceTypes = detectServiceTypes(
    `${example.leadIndustry || ""} ${example.aiOriginalDraft} ${example.userFinalSentEmail}`
  );
  return serviceTypes.filter((type) => exampleServiceTypes.includes(type)).length * 25;
}

function scoreCountry(exampleCountry: string | null, clientCountry: string | null) {
  if (!exampleCountry || !clientCountry) return 0;
  return exampleCountry.toLowerCase() === clientCountry.toLowerCase() ? 50 : 0;
}

function extractLeadMetadata(notes: string | null | undefined, key: "country") {
  if (!notes) return null;
  const match = notes.match(new RegExp(`${key}\\s*:\\s*([^\\n,;]+)`, "i"));
  return match?.[1]?.trim() || null;
}

function describeClientBrain(clientBrain: ClientBrain | null | undefined) {
  if (!clientBrain) return "";
  return [
    clientBrain.summary ? `Summary: ${clientBrain.summary}` : "",
    clientBrain.interestedService ? `Interested service: ${clientBrain.interestedService}` : "",
    clientBrain.budgetRange ? `Budget: ${clientBrain.budgetRange}` : "",
    clientBrain.painPoints ? `Pain points: ${JSON.stringify(clientBrain.painPoints)}` : "",
    clientBrain.objections ? `Objections: ${JSON.stringify(clientBrain.objections)}` : "",
    clientBrain.preferredTone ? `Preferred tone: ${clientBrain.preferredTone}` : "",
    clientBrain.preferredEmailTime ? `Preferred email time: ${clientBrain.preferredEmailTime}` : "",
    clientBrain.currentTemperature ? `Current temperature: ${clientBrain.currentTemperature}` : "",
    clientBrain.decisionStage ? `Decision stage: ${clientBrain.decisionStage}` : "",
    clientBrain.recommendedNextStep ? `Recommended next step: ${clientBrain.recommendedNextStep}` : "",
    clientBrain.nextBestAction ? `Next best action: ${clientBrain.nextBestAction}` : ""
  ].filter(Boolean).join("\n");
}
