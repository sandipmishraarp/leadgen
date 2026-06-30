import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { processDueScheduledEmails } from "@/lib/services/scheduled-email";

export async function POST() {
  try {
    await requireUser();
    const result = await processDueScheduledEmails();
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
