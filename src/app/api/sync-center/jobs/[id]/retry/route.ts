import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { syncAccountNow } from "@/lib/services/sync-engine";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const syncJob = (prisma as any).syncJob;
    if (!syncJob?.findUnique) throw new Error("Sync job reporting is not available. Run prisma generate and restart the server.");
    const job = await syncJob.findUnique({ where: { id: params.id } });
    if (!job?.accountId) throw new Error("Sync job account not found");
    const result = await syncAccountNow(job.accountId, { trigger: "manual", batchSize: job.batchSize, concurrency: job.concurrency });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
