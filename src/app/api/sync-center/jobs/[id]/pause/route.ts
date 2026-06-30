import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const syncJob = (prisma as any).syncJob;
    if (!syncJob?.update) throw new Error("Sync job reporting is not available. Run prisma generate and restart the server.");
    const job = await syncJob.update({
      where: { id: params.id },
      data: { status: "PAUSED", pausedAt: new Date() }
    });
    return jsonOk({ job });
  } catch (error) {
    return jsonError(error);
  }
}
