import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { cleanupStaleLeadImportJobs, clearCompletedLeadImportJobs, createLeadImportJob } from "@/lib/services/lead-import";

const schema = z.object({
  accountId: z.string().min(1),
  folderPaths: z.array(z.string().min(1)).min(1),
  batchSize: z.number().int().min(10).max(500).optional()
});

export async function GET() {
  try {
    await requireUser();
    await cleanupStaleLeadImportJobs();
    const jobs = await prisma.leadImportJob.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { folders: { orderBy: { folderPath: "asc" } }, account: true }
    });
    return jsonOk({ jobs });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const result = await clearCompletedLeadImportJobs(searchParams.get("accountId") || undefined);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const job = await createLeadImportJob(input);
    return jsonOk({ job });
  } catch (error) {
    return jsonError(error);
  }
}
