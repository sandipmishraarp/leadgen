import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { SALES_AGENT_SYSTEM_PROMPT } from "@/ai/prompts/sales-agent-system-prompt";
import { PROMPT_LIBRARY } from "@/ai/prompts/prompt-library";
import { truncateText } from "@/lib/services/ai-usage";
import { parseJsonOutput, routeAiText } from "@/lib/services/ai-router";

const schema = z.object({
  action: z.string().min(1),
  html: z.string().default(""),
  text: z.string().default(""),
  subject: z.string().default("")
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
    const feature = input.action.toLowerCase().includes("subject") ? "SUBJECT_GENERATION" : "REWRITE_ACTION";
    const compactInput = {
      action: input.action,
      subject: truncateText(input.subject, 160),
      html: truncateText(input.html, 2500),
      text: truncateText(input.text, 1600)
    };
    const parsed = await routeAiText<{ subject?: string; html?: string; text?: string }>({
      apiKey,
      feature,
      userId: user.id,
      action: input.action,
      cacheInput: compactInput,
      input: [
        { role: "system", content: SALES_AGENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            input.action.toLowerCase().includes("subject") ? PROMPT_LIBRARY.SUBJECT : PROMPT_LIBRARY.REWRITE,
            `Composer action: ${compactInput.action}`,
            `Current subject: ${compactInput.subject}`,
            "Return JSON only:",
            '{"subject":"","html":"","text":""}',
            "Preserve useful formatting as HTML. Keep AResourcePool professional sales tone.",
            "Current HTML:",
            compactInput.html,
            "Current text:",
            compactInput.text
          ].join("\n")
        }
      ],
      parse: (text) => parseJsonOutput(text, {})
    });
    return jsonOk({
      subject: parsed.subject || undefined,
      html: parsed.html || undefined,
      text: parsed.text || undefined
    });
  } catch (error) {
    return jsonError(error);
  }
}
