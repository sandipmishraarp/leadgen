import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { syncAccountNow } from "@/lib/services/sync-engine";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
  } catch (error) {
    return jsonError(error);
  }
  try {
    const account = await prisma.emailAccount.findUnique({ where: { id: params.id } });
    if (!account) throw new Error("Email account not found");
    const result = await syncAccountNow(account.id, { trigger: "manual" });
    return jsonOk(result);
  } catch (error) {
    await prisma.emailAccount.update({
      where: { id: params.id },
      data: { status: "ERROR", connectionStatus: { error: error instanceof Error ? error.message : String(error), syncedAt: new Date().toISOString() } }
    }).catch(() => null);
    return jsonError(error);
  }
}
