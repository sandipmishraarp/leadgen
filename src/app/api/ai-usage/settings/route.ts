import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { updateAiUsageSettings } from "@/lib/services/ai-usage";

const schema = z.object({
  dailyTokenLimit: z.number().int().min(0),
  dailyCostLimit: z.number().min(0),
  perUserDailyTokenLimit: z.number().int().min(0).nullable().optional(),
  smallModel: z.string().min(1),
  mainModel: z.string().min(1),
  bulkDraftsPerHour: z.number().int().min(1)
});

export async function PATCH(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const settings = await updateAiUsageSettings(input);
    return jsonOk({ settings });
  } catch (error) {
    return jsonError(error);
  }
}
