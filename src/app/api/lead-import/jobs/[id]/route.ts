import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { getLeadImportJob, retryFailedLeadImportJob, stopLeadImportJob } from "@/lib/services/lead-import";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const job = await getLeadImportJob(params.id);
    if (!job) return jsonOk({ error: "Lead import job not found" }, { status: 404 });
    return jsonOk({ job });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    const job = action === "retry" ? await retryFailedLeadImportJob(params.id) : await stopLeadImportJob(params.id);
    return jsonOk({ job });
  } catch (error) {
    return jsonError(error);
  }
}
