const INTERNAL_EMAILS = [
  "lead@aresourcepool.com",
  "sales@aresourcepool.com",
  "abhay@aresourcepool.com",
  "sandip@aresourcepool.com"
];

const REJECTED_LINE_LABELS = [
  "to",
  "cc",
  "bcc",
  "reply to",
  "reply-to",
  "forwarded by",
  "forwarded-by",
  "sender",
  "lead generator",
  "lead provider",
  "provider email",
  "submitted to"
];

type ExtractedEmail = {
  clientEmail: string | null;
  clientName: string | null;
  confidence: number;
  reason: string;
  rejectedEmails: string[];
};

export type ParsedLeadIntake = {
  name: string | null;
  clientName: string | null;
  clientEmail: string | null;
  website: string | null;
  phone: string | null;
  country: string | null;
  service: string | null;
  company: string | null;
  forwardedClientMessage: string | null;
  originalClientMessage: string | null;
  originalClientName: string | null;
  originalClientEmail: string | null;
  originalClientPhone: string | null;
  originalWebsite: string | null;
  originalCompany: string | null;
  originalSubject: string | null;
  originalConversationText: string | null;
  latestClientMessage: string | null;
  previousProviderMessages: string | null;
  fullForwardedChain: string | null;
  detectedIntent: string | null;
  requestedItems: string[];
  recommendedReplyType: string | null;
  leadSourceType: string | null;
  conversationType: string | null;
  replyMode: string | null;
  forwardedBy: string | null;
  providerEmail: string | null;
  leadProvider: string | null;
  sourceFolder: string | null;
  sourceFolderPath: string | null;
  confidence: number;
  reason: string;
  rejectedEmails: string[];
  reviewerDecision: ReviewerDecision | null;
};

export type ReviewerDecision = {
  approvalStatus: "approved_by_reviewer" | "not_approved_by_reviewer" | "hold_by_reviewer";
  sandipReviewRequired: boolean;
  sandipDecisionStatus: "pending" | null;
  reviewerComment: string;
};

export function parseLeadIntakeEmail(input: {
  text?: string | null;
  html?: string | null;
  fromEmail: string;
  fromName?: string | null;
  internalDomain?: string | null;
  sourceFolder?: string | null;
  sourceFolderPath?: string | null;
  sourceProviderName?: string | null;
}) {
  const text = normalizeText(input.text || stripHtml(input.html || ""));
  const internalDomain = input.internalDomain || "aresourcepool.com";
  const emailExtraction = extractClientEmail(text, {
    fromEmail: input.fromEmail,
    internalDomain
  });
  const originalClientMessage = extractOriginalClientMessage(text);
  const forwardedContext = extractForwardedLeadContext(text, {
    clientEmail: emailExtraction.clientEmail,
    providerEmail: input.fromEmail,
    providerName: input.fromName,
    fallbackSubject: pickField(text, ["subject"])
  });
  const clientName = pickClientName(text, emailExtraction.clientName);
  const latestClientMessage = forwardedContext.latestClientMessage || originalClientMessage;
  const intent = classifyLeadIntent(latestClientMessage || originalClientMessage || text);
  const requestedItems = detectRequestedItems(latestClientMessage || originalClientMessage || text);
  const reviewerDecision = detectReviewerDecision(text);

  return {
    name: forwardedContext.originalClientName || clientName,
    clientName: forwardedContext.originalClientName || clientName,
    clientEmail: emailExtraction.clientEmail,
    website: forwardedContext.originalWebsite || normalizeWebsite(pickField(text, ["website", "site", "url", "web site"])),
    phone: forwardedContext.originalClientPhone || pickField(text, ["phone", "mobile", "contact number", "telephone", "whatsapp"]),
    country: pickField(text, ["country", "location"]),
    service: pickField(text, ["service", "services", "requirement", "project", "looking for"]),
    company: forwardedContext.originalCompany || pickField(text, ["company", "business", "organization", "organisation"]),
    forwardedClientMessage: forwardedContext.fullForwardedChain || originalClientMessage,
    originalClientMessage: latestClientMessage,
    originalClientName: forwardedContext.originalClientName || clientName,
    originalClientEmail: emailExtraction.clientEmail,
    originalClientPhone: forwardedContext.originalClientPhone,
    originalWebsite: forwardedContext.originalWebsite,
    originalCompany: forwardedContext.originalCompany,
    originalSubject: forwardedContext.originalSubject,
    originalConversationText: forwardedContext.originalConversationText || originalClientMessage,
    latestClientMessage,
    previousProviderMessages: forwardedContext.previousProviderMessages,
    fullForwardedChain: forwardedContext.fullForwardedChain,
    detectedIntent: intent,
    requestedItems,
    recommendedReplyType: recommendReplyType(intent, requestedItems),
    leadSourceType: forwardedContext.fullForwardedChain ? "forwarded_provider_lead" : null,
    conversationType: forwardedContext.fullForwardedChain && intent !== "UNKNOWN" ? "warm_reply" : null,
    replyMode: forwardedContext.fullForwardedChain ? "continue_existing_conversation" : null,
    forwardedBy: forwardedContext.forwardedBy,
    providerEmail: normalizeEmail(input.fromEmail),
    leadProvider: input.sourceProviderName || detectProviderName(text, input.fromEmail, input.fromName),
    sourceFolder: input.sourceFolder || null,
    sourceFolderPath: input.sourceFolderPath || null,
    confidence: emailExtraction.confidence,
    reason: emailExtraction.reason,
    rejectedEmails: emailExtraction.rejectedEmails,
    reviewerDecision
  } satisfies ParsedLeadIntake;
}

export function detectReviewerDecision(text: string | null): ReviewerDecision | null {
  const lines = normalizeText(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  const compact = lines.join("\n").slice(0, 2000);
  const decisionText = compact.toLowerCase();
  if (/\b(not\s+approved|not\s+approve|rejected|reject\s+this)\b/.test(decisionText)) {
    return {
      approvalStatus: "not_approved_by_reviewer",
      sandipReviewRequired: true,
      sandipDecisionStatus: "pending",
      reviewerComment: compact
    };
  }
  if (/\b(keep\s+on\s+hold|hold)\b/.test(decisionText)) {
    return {
      approvalStatus: "hold_by_reviewer",
      sandipReviewRequired: true,
      sandipDecisionStatus: "pending",
      reviewerComment: compact
    };
  }
  if (/\bapproved\b/.test(decisionText)) {
    return {
      approvalStatus: "approved_by_reviewer",
      sandipReviewRequired: false,
      sandipDecisionStatus: null,
      reviewerComment: compact
    };
  }
  return null;
}

type ForwardedContext = {
  originalClientName: string | null;
  originalClientPhone: string | null;
  originalWebsite: string | null;
  originalCompany: string | null;
  originalSubject: string | null;
  originalConversationText: string | null;
  latestClientMessage: string | null;
  previousProviderMessages: string | null;
  fullForwardedChain: string | null;
  forwardedBy: string | null;
};

function extractForwardedLeadContext(text: string, input: { clientEmail: string | null; providerEmail: string; providerName?: string | null; fallbackSubject?: string | null }): ForwardedContext {
  const fullForwardedChain = extractForwardedChain(text);
  const chain = fullForwardedChain || text;
  const blocks = parseMessageBlocks(chain);
  const clientEmail = normalizeEmail(input.clientEmail || "");
  const clientBlocks = blocks.filter((block) => clientEmail && normalizeEmail(block.fromEmail || "") === clientEmail);
  const providerEmail = normalizeEmail(input.providerEmail);
  const providerBlocks = blocks.filter((block) => {
    const email = normalizeEmail(block.fromEmail || "");
    return email && email !== clientEmail && (email === providerEmail || !email.endsWith("@aresourcepool.com"));
  });
  const latestClient = clientBlocks[0] || null;
  const anyClient = latestClient || blocks.find((block) => clientEmail && block.body.toLowerCase().includes(clientEmail));

  return {
    originalClientName: latestClient?.fromName || findNameNearEmail(`From: ${clientEmail}`),
    originalClientPhone: pickField(chain, ["phone", "mobile", "contact number", "telephone", "whatsapp"]),
    originalWebsite: normalizeWebsite(pickField(chain, ["website", "site", "url", "web site"])),
    originalCompany: pickField(chain, ["company", "business", "organization", "organisation"]),
    originalSubject: latestClient?.subject || blocks.find((block) => block.subject)?.subject || input.fallbackSubject || null,
    originalConversationText: chain ? chain.slice(0, 12000) : null,
    latestClientMessage: cleanMessageBody(anyClient?.body || "") || null,
    previousProviderMessages: providerBlocks.map((block) => cleanMessageBody(block.body)).filter(Boolean).join("\n\n---\n\n").slice(0, 6000) || null,
    fullForwardedChain: fullForwardedChain ? fullForwardedChain.slice(0, 20000) : null,
    forwardedBy: input.providerName || input.providerEmail || null
  };
}

function extractForwardedChain(text: string) {
  const markers = [
    /-{2,}\s*forwarded message\s*-{2,}/i,
    /begin forwarded message:/i,
    /forwarded email chain/i,
    /original message/i,
    /^from:\s/im,
    /^on .+ wrote:\s*$/im
  ];
  const indexes = markers
    .map((marker) => marker.exec(text)?.index)
    .filter((index): index is number => typeof index === "number" && index >= 0);
  if (!indexes.length) return null;
  return text.slice(Math.min(...indexes)).trim();
}

function parseMessageBlocks(text: string) {
  const lines = text.split("\n");
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (/^\s*from\s*:/i.test(line) || /^\s*on .+ wrote:\s*$/i.test(line)) starts.push(index);
  });
  if (!starts.length) return [];
  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    const blockLines = lines.slice(start, end);
    const headerText = blockLines.slice(0, 12).join("\n");
    const from = parseFromHeader(headerText);
    const subject = headerText.match(/^\s*subject\s*:\s*(.+)$/im)?.[1]?.trim() || null;
    const bodyStart = blockLines.findIndex((line, index) => index > 0 && !/^\s*(from|date|subject|to|cc)\s*:/i.test(line) && line.trim());
    const body = blockLines.slice(bodyStart > -1 ? bodyStart : 1).join("\n");
    return { fromEmail: from.email, fromName: from.name, subject, body };
  });
}

function parseFromHeader(text: string) {
  const fromLine = text.split("\n").find((line) => /^\s*from\s*:/i.test(line)) || "";
  const email = findEmails(fromLine)[0] || "";
  const name = findNameNearEmail(fromLine);
  return { email, name };
}

function cleanMessageBody(value: string) {
  return value
    .replace(/^\s*(from|date|subject|to|cc)\s*:.*$/gim, "")
    .replace(/-{2,}\s*forwarded message\s*-{2,}/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

function classifyLeadIntent(text: string | null) {
  const value = (text || "").toLowerCase();
  if (!value) return "UNKNOWN";
  if (/\b(not interested|no thanks|stop|unsubscribe)\b/.test(value)) return "NOT_INTERESTED";
  if (/\b(portfolio|examples?|case studies?|company website|website link|your website|work samples?)\b/.test(value)) return "REQUESTED_PORTFOLIO";
  if (/\b(mockup|sample improvement|sample design|preview|demo)\b/.test(value)) return "REQUESTED_MOCKUP";
  if (/\b(timeline|how long|when can|delivery|duration|timeframe)\b/.test(value)) return "REQUESTED_TIMELINE";
  if (/\b(how much|price|pricing|cost|quote|estimate|budget)\b/.test(value)) return "ASKED_PRICING";
  if (/\b(requirements?|scope|what do you need|details)\b/.test(value)) return "ASKED_REQUIREMENTS";
  if (/\b(confused|what do you mean|clarify|clarification|don't understand|do not understand)\b/.test(value)) return "CONFUSED";
  if (/\b(yes|interested|open to|sounds good|reviewing what your team can do|send me|please share)\b/.test(value)) return "INTERESTED";
  return "UNKNOWN";
}

function detectRequestedItems(text: string | null) {
  const value = (text || "").toLowerCase();
  const items: string[] = [];
  if (/\b(company website|your website|website link)\b/.test(value)) items.push("Company website");
  if (/\b(portfolio|examples?|case studies?|work samples?)\b/.test(value)) items.push("Portfolio examples");
  if (/\b(how much|package|packages|options|pricing|price|cost|budget)\b/.test(value)) items.push("Package options / pricing");
  if (/\b(mockup|sample improvement|sample design|preview)\b/.test(value)) items.push("Sample improvement/mockup");
  if (/\b(timeline|how long|duration|timeframe)\b/.test(value)) items.push("General timeline");
  return Array.from(new Set(items));
}

function recommendReplyType(intent: string, requestedItems: string[]) {
  if (intent === "ASKED_PRICING") return "Answer pricing question with realistic range and 2-3 scope questions.";
  if (requestedItems.length) return `Answer requested items: ${requestedItems.join(", ")}.`;
  if (intent === "INTERESTED") return "Acknowledge interest and suggest a clear next step.";
  if (intent === "CONFUSED") return "Clarify the offer simply and ask one direct question.";
  if (intent === "NOT_INTERESTED") return "Do not contact unless manually overridden.";
  return "Send context-aware reply using forwarded conversation.";
}

export function extractClientEmail(
  text: string,
  options: { fromEmail: string; internalDomain: string }
): ExtractedEmail {
  const rejectedEmails = new Set<string>();
  const baseRejected = new Set(
    [...INTERNAL_EMAILS, options.fromEmail]
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
  const internalDomain = options.internalDomain.toLowerCase();

  const labeled = findLabeledEmails(text, ["client email", "client email id", "email", "email id", "e-mail"]);
  for (const candidate of labeled) {
    const rejectionReason = getEmailRejectionReason(candidate.email, baseRejected, internalDomain);
    if (!rejectionReason && !isRejectedContext(candidate.line)) {
      return withRejectedEmails(text, baseRejected, internalDomain, candidate.email, {
        clientEmail: candidate.email,
        clientName: findNameNearEmail(candidate.line),
        confidence: /^client\s+email/i.test(candidate.label) ? 96 : 90,
        reason: `Matched structured ${candidate.label} field.`,
        rejectedEmails: Array.from(rejectedEmails)
      });
    }
    rejectedEmails.add(candidate.email);
  }

  const forwarded = findForwardedFromEmails(text);
  for (const candidate of forwarded) {
    const rejectionReason = getEmailRejectionReason(candidate.email, baseRejected, internalDomain);
    if (!rejectionReason) {
      return withRejectedEmails(text, baseRejected, internalDomain, candidate.email, {
        clientEmail: candidate.email,
        clientName: candidate.name,
        confidence: 88,
        reason: "Matched forwarded From header.",
        rejectedEmails: Array.from(rejectedEmails)
      });
    }
    rejectedEmails.add(candidate.email);
  }

  const candidates = findEmailCandidates(text);
  for (const candidate of candidates) {
    const rejectionReason = getEmailRejectionReason(candidate.email, baseRejected, internalDomain);
    if (rejectionReason || isRejectedContext(candidate.line)) {
      rejectedEmails.add(candidate.email);
      continue;
    }

    return withRejectedEmails(text, baseRejected, internalDomain, candidate.email, {
      clientEmail: candidate.email,
      clientName: findNameNearEmail(candidate.line),
      confidence: 68,
      reason: "Matched external email fallback, but no structured client field or forwarded From header was found.",
      rejectedEmails: Array.from(rejectedEmails)
    });
  }

  for (const email of findEmails(text)) {
    if (getEmailRejectionReason(email, baseRejected, internalDomain)) rejectedEmails.add(email);
  }

  return withRejectedEmails(text, baseRejected, internalDomain, null, {
    clientEmail: null,
    clientName: null,
    confidence: 0,
    reason: "No valid external client email found.",
    rejectedEmails: Array.from(rejectedEmails)
  });
}

function pickClientName(text: string, fallback: string | null) {
  return pickField(text, ["client name", "name", "full name", "contact person"]) || fallback;
}

function pickField(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`^\\s*${escapeRegex(label)}\\s*(?::\\s*-?|:-|=|-)\\s*(.+)$`, "im");
    const match = text.match(pattern);
    if (match?.[1]) return cleanValue(match[1]);
  }
  return null;
}

function findLabeledEmails(text: string, labels: string[]) {
  const results: { label: string; email: string; line: string }[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`^\\s*${escapeRegex(label)}\\s*(?::\\s*-?|:-|=|-)\\s*(.+)$`, "i");
      const match = line.match(pattern);
      if (!match?.[1]) continue;
      for (const email of findEmails(match[1])) results.push({ label, email, line });
    }
  }
  return uniqueByEmail(results);
}

function findForwardedFromEmails(text: string) {
  const results: { email: string; name: string | null; line: string }[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*from\s*:\s*(?:"?([^"<@]+)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>/i)
      || line.match(/^\s*from\s*:\s*([^<>\s]+@[^<>\s]+)/i);
    if (!match) continue;
    const rawName = match.length > 2 ? match[1] : null;
    const rawEmail = match.length > 2 ? match[2] : match[1];
    results.push({
      email: normalizeEmail(rawEmail),
      name: cleanValue(rawName || "") || null,
      line
    });
  }
  return uniqueByEmail(results);
}

function findEmailCandidates(text: string) {
  const results: { email: string; line: string }[] = [];
  for (const line of text.split("\n")) {
    for (const email of findEmails(line)) results.push({ email, line });
  }
  return uniqueByEmail(results);
}

function withRejectedEmails(
  text: string,
  baseRejected: Set<string>,
  internalDomain: string,
  selectedEmail: string | null,
  result: ExtractedEmail
) {
  const rejectedEmails = new Set(result.rejectedEmails);
  for (const candidate of findEmailCandidates(text)) {
    if (selectedEmail && candidate.email === selectedEmail) continue;
    if (getEmailRejectionReason(candidate.email, baseRejected, internalDomain) || isRejectedContext(candidate.line)) {
      rejectedEmails.add(candidate.email);
    }
  }
  return { ...result, rejectedEmails: Array.from(rejectedEmails) };
}

function findEmails(text: string) {
  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  return Array.from(new Set(matches.map(normalizeEmail).filter(Boolean)));
}

function getEmailRejectionReason(email: string, rejected: Set<string>, internalDomain: string) {
  const normalized = normalizeEmail(email);
  const domain = normalized.split("@")[1] || "";
  if (!normalized) return "empty";
  if (rejected.has(normalized)) return "known internal or lead generator email";
  if (domain === internalDomain) return "internal domain";
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i.test(normalized)) return "system sender";
  if (normalized.includes("noreply") || normalized.includes("no-reply")) return "no-reply sender";
  return null;
}

function isRejectedContext(line: string) {
  const normalized = line.trim().toLowerCase();
  return REJECTED_LINE_LABELS.some((label) => new RegExp(`^${escapeRegex(label)}\\s*(?::\\s*-?|:-|=|-)`, "i").test(normalized));
}

function findNameNearEmail(line: string) {
  const angleMatch = line.match(/([A-Za-z][^<>\n]{1,80})<[^<>@\s]+@[^<>@\s]+>/);
  if (angleMatch?.[1]) return cleanValue(angleMatch[1].replace(/^from\s*:/i, ""));
  const labelValue = line.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "").replace(/client\s+email|email|from|:/gi, "");
  return cleanValue(labelValue);
}

function extractOriginalClientMessage(text: string) {
  const markers = [
    /-{2,}\s*forwarded message\s*-{2,}/i,
    /begin forwarded message:/i,
    /forwarded email chain/i,
    /original message/i,
    /^from:\s/im
  ];
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match?.index !== undefined && match.index >= 0) {
      return text.slice(match.index).trim().slice(0, 5000);
    }
  }
  return null;
}

function detectProviderName(text: string, fromEmail: string, fromName?: string | null) {
  const explicit = pickField(text, ["provider", "lead provider", "source"]);
  if (explicit) return explicit;
  if (fromName) return fromName;
  const domain = fromEmail.split("@")[1];
  return domain ? domain.split(".")[0] : null;
}

function normalizeWebsite(value: string | null) {
  if (!value) return null;
  const match = value.match(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}/i);
  return match?.[0]?.replace(/[),.]+$/, "") || value;
}

function normalizeText(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function cleanValue(value: string | null) {
  return value
    ?.replace(/\[mailto\]/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim() || null;
}

function normalizeEmail(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/\[mailto\]/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, " ")
    .trim();
  const match = cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0]?.replace(/[),.;]+$/, "") || "";
}

function uniqueByEmail<T extends { email: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.email)) return false;
    seen.add(item.email);
    return true;
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
