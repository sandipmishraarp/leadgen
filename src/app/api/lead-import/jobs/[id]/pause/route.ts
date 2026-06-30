import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { pauseLeadImportJob } from "@/lib/services/lead-import";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const job = await pauseLeadImportJob(params.id);
    return jsonOk({ job });
  } catch (error) {
    return jsonError(error);
  }
}
