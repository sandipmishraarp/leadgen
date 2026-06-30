import { SALES_AGENT_SYSTEM_PROMPT } from "./prompts/sales-agent-system-prompt";
import { PROMPT_LIBRARY } from "@/ai/prompts/prompt-library";
import { compressSalesEmailContext, type AiFeature } from "@/lib/services/ai-usage";
import { routeAiText } from "@/lib/services/ai-router";

export type GenerateSalesEmailInput = {
  emailType: "REPLY" | "FOLLOWUP" | string;
  lead: Record<string, unknown>;
  threadMessages: Array<Record<string, unknown>>;
  knowledgeContext?: string;
  previousApprovedExamples?: Array<Record<string, unknown> | string>;
  userInstruction?: string;
};

export type GeneratedSalesEmail = {
  subject: string;
  body: string;
  confidence: number;
  suggested_status: string;
  next_action: string;
  fallbackDraft?: boolean;
};

export async function generateSalesEmail(
  input: GenerateSalesEmailInput,
  options: { apiKey?: string; model?: string; feature?: AiFeature; leadId?: string | null; userId?: string | null } = {}
): Promise<GeneratedSalesEmail> {
  const compactInput = compressSalesEmailContext(input);
  const feature = options.feature || (String(input.emailType).toUpperCase().includes("FOLLOW") ? "FOLLOW_UP_GENERATION" : "DRAFT_GENERATION");

  return routeAiText({
    apiKey: options.apiKey,
    feature,
    leadId: options.leadId || String(input.lead.id || "") || null,
    userId: options.userId || null,
    action: String(input.emailType),
    model: options.model,
    cacheInput: compactInput,
    input: [
      {
        role: "system",
        content: SALES_AGENT_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `
Prompt:
${String(input.emailType).toUpperCase().includes("FOLLOW") ? PROMPT_LIBRARY.FOLLOW_UP : PROMPT_LIBRARY.FIRST_DRAFT}

Email Type:
${compactInput.emailType}

Lead:
${JSON.stringify(compactInput.lead)}

Compact Context:
${JSON.stringify(compactInput.threadMessages)}

Relevant Knowledge Context:
${compactInput.knowledgeContext || ""}

Previous Approved Email Examples:
${JSON.stringify(compactInput.previousApprovedExamples || [])}

User Instruction:
${compactInput.userInstruction || ""}

Generate the best email draft.
Return ONLY valid JSON:
{
  "subject": "string",
  "body": "string",
  "confidence": 0.0,
  "suggested_status": "",
  "next_action": ""
}
No markdown.
No explanation.
No empty body.
`
      }
    ],
    parse: parseGeneratedSalesEmail
  });
}

function parseGeneratedSalesEmail(text: string): GeneratedSalesEmail {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: Partial<GeneratedSalesEmail>;
  let parseError = "";
  try {
    parsed = JSON.parse(cleaned) as Partial<GeneratedSalesEmail>;
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    parsed = { body: cleaned };
  }
  const body = parsed.body ?? (parsed as any).draft ?? (parsed as any).emailBody ?? "";
  if (parseError) {
    console.info("[AI draft parse]", {
      parseError,
      responseTextLength: cleaned.length,
      parsedDraftLength: String(body || "").length
    });
  }
  return {
    subject: String(parsed.subject || ""),
    body: String(body || ""),
    confidence: Number(parsed.confidence || 0),
    suggested_status: String(parsed.suggested_status || ""),
    next_action: String(parsed.next_action || "")
  };
}
