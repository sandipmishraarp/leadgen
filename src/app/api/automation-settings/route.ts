import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { automationSettingDelegate, getAutomationSettings, saveAutomationSettingsRaw } from "@/lib/services/safe-automation";

const schema = z.object({
  autoSyncEnabled: z.boolean().optional(),
  autoClassifyEnabled: z.boolean().optional(),
  autoCreateReplyDrafts: z.boolean().optional(),
  autoCreateFollowupDrafts: z.boolean().optional(),
  autoBlockDoNotContact: z.boolean().optional(),
  autoSuggestSchedule: z.boolean().optional(),
  followup1Days: z.number().int().min(1).max(60).optional(),
  followup2Days: z.number().int().min(1).max(90).optional(),
  followup3Days: z.number().int().min(1).max(120).optional(),
  finalFollowupDays: z.number().int().min(1).max(180).optional()
});

export async function GET() {
  try {
    await requireUser();
    const settings = await getAutomationSettings();
    return jsonOk({ settings });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const delegate = automationSettingDelegate();
    if (!delegate) {
      const settings = await saveAutomationSettingsRaw(input);
      return jsonOk({ settings });
    }
    let settings;
    try {
      settings = await delegate.upsert({
        where: { id: "default" },
        create: { id: "default", ...input },
        update: input
      });
    } catch {
      settings = await saveAutomationSettingsRaw(input);
    }
    return jsonOk({ settings });
  } catch (error) {
    return jsonError(error);
  }
}
