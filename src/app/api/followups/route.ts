import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { getSalesFollowupsForMailbox } from "@/lib/services/followups";
import { resolveMailboxContext } from "@/lib/services/mailbox-filter";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const mailbox = await resolveMailboxContext(searchParams.get("mailbox") || searchParams.get("activeAccountEmail"), "abhay@aresourcepool.com");
    const followups = await getSalesFollowupsForMailbox(mailbox);
    return jsonOk({ mailbox, followups });
  } catch (error) {
    return jsonError(error);
  }
}
