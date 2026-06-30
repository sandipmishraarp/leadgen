import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const account = await prisma.emailAccount.findUnique({ where: { id: params.id }, select: { id: true, emailAddress: true } });
    if (!account) throw new Error("Email account not found");
    const result = await prisma.emailFolderSyncState.updateMany({
      where: { accountId: account.id },
      data: {
        lastUid: 0,
        highestUid: 0,
        uidValidity: null,
        status: "PENDING",
        lastError: null,
        lastSyncedAt: null
      }
    });
    return jsonOk({ account, resetFolders: result.count });
  } catch (error) {
    return jsonError(error);
  }
}
