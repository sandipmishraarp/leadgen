import OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import {
  chooseAiModel,
  executeAiCall,
  optimizeAiText,
  truncateText,
  type AiFeature
} from "@/lib/services/ai-usage";

type RouteTextInput<T> = {
  apiKey?: string;
  feature: AiFeature;
  leadId?: string | null;
  userId?: string | null;
  action?: string | null;
  model?: string;
  input: ResponseInput;
  cacheInput?: unknown;
  parse: (outputText: string) => T;
};

export async function routeAiText<T>(input: RouteTextInput<T>): Promise<T> {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key is not configured.");
  const model = chooseAiModel(input.feature, input.model);
  const optimizedInput = optimizeResponseInput(input.input);
  const cacheInput = input.cacheInput || optimizedInput;
  const openai = new OpenAI({ apiKey });

  return executeAiCall({
    feature: input.feature,
    leadId: input.leadId,
    userId: input.userId,
    action: input.action,
    model,
    inputForCache: cacheInput,
    call: async () => {
      const response = await openai.responses.create({ model, input: optimizedInput });
      const outputText = extractAiText(response);
      const parsed = input.parse(outputText);
      if (input.feature === "DRAFT_GENERATION" || input.feature === "FOLLOW_UP_GENERATION") {
        logDraftAiResponse({
          model,
          feature: input.feature,
          response,
          outputText,
          parsed
        });
      }
      return { response, parsed };
    }
  });
}

export function extractAiText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  const value = response as Record<string, any>;
  if (typeof value.output_text === "string" && value.output_text.trim()) return value.output_text;
  const outputText = collectText(value.output);
  if (outputText.trim()) return outputText;
  const choicesText = collectText(value.choices?.[0]?.message?.content);
  if (choicesText.trim()) return choicesText;
  return collectText(value.content);
}

function collectText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (typeof item.text === "string") return item.text;
    if (typeof item.output_text === "string") return item.output_text;
    if (typeof item.content === "string") return item.content;
    if (item.content) return collectText(item.content);
    if (item.message) return collectText(item.message);
  }
  return "";
}

function logDraftAiResponse(input: {
  model: string;
  feature: AiFeature;
  response: unknown;
  outputText: string;
  parsed: unknown;
}) {
  const response = input.response as Record<string, any>;
  const parsedBody = typeof input.parsed === "object" && input.parsed
    ? String((input.parsed as Record<string, unknown>).body || "")
    : "";
  console.info("[AI draft response]", {
    model: input.model,
    feature: input.feature,
    requestId: response?._request_id || response?.request_id || response?.id || null,
    responseTextLength: input.outputText.length,
    parsedDraftLength: parsedBody.length
  });
}

export async function routeAiEmbeddings(input: {
  apiKey?: string;
  texts: string[];
  action?: string;
}) {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key is not configured.");
  const model = chooseAiModel("KNOWLEDGE_EMBEDDING");
  const optimizedTexts = input.texts.map((text) => optimizeAiText(text, 1800));
  const openai = new OpenAI({ apiKey });
  return executeAiCall({
    feature: "KNOWLEDGE_EMBEDDING",
    action: input.action || "embedding",
    model,
    inputForCache: optimizedTexts,
    call: async () => {
      const response = await openai.embeddings.create({ model, input: optimizedTexts });
      const parsed = response.data.map((item) => item.embedding);
      return {
        response: {
          output_text: "",
          usage: {
            input_tokens: optimizedTexts.join(" ").length / 4,
            output_tokens: 0
          }
        } as unknown as OpenAI.Responses.Response,
        parsed
      };
    }
  });
}

function optimizeResponseInput(input: ResponseInput): ResponseInput {
  return input.map((item) => {
    if ("content" in item && typeof item.content === "string") {
      return { ...item, content: optimizeAiText(item.content, 6000) };
    }
    if ("content" in item && Array.isArray(item.content)) {
      return {
        ...item,
        content: item.content.map((contentItem) => {
          if ("text" in contentItem && typeof contentItem.text === "string") {
            return { ...contentItem, text: optimizeAiText(contentItem.text, 6000) };
          }
          return contentItem;
        })
      };
    }
    return item;
  }) as ResponseInput;
}

export function parseJsonOutput<T>(text: string, fallback: T): T {
  const cleaned = truncateText(text.replace(/```json|```/g, "").trim(), 12000);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}
