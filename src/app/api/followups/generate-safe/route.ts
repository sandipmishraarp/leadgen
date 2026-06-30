import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { FOLLOWUP_STATES } from "@/lib/services/followup-state";
import { getSalesFollowupsForMailbox } from "@/lib/services/followups";
import { resolveMailboxContext } from "@/lib/services/mailbox-filter";
import { generateReplyDraft } from "@/lib/services/openai";

const schema = z.object({
  mailbox: z.string().email(),
  limit: z.number().int().min(1).max(10).default(10)
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const mailbox = await resolveMailboxContext(input.mailbox, input.mailbox);
    const due = await getSalesFollowupsForMailbox(mailbox, FOLLOWUP_STATES.DUE);
    const safe = due.filter((item) =>
      item.bucket === "AUTO_DRAFT_SAFE"
      && !item.contactBlock?.blocked
      && !item.draftId
      && !item.scheduledEmailId
    ).slice(0, input.limit);

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ threadId: string; error: string }> = [];

    for (const item of safe) {
      try {
        await generateReplyDraft(item.threadId, "FOLLOWUP");
        generated += 1;
      } catch (error) {
        failed += 1;
        errors.push({ threadId: item.threadId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    skipped = Math.max(0, due.filter((item) => item.bucket === "AUTO_DRAFT_SAFE").length - generated - failed);
    return jsonOk({
      generated,
      skipped,
      failed,
      totalConsidered: safe.length,
      errors
    });
  } catch (error) {
    return jsonError(error);
  }
}
