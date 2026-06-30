import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { listImapFolders } from "@/lib/services/lead-import";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const result = await listImapFolders(params.id);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
