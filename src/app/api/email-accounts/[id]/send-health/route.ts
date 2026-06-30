import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getAccountSendHealth } from "@/lib/services/send-safety";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const account = await prisma.emailAccount.findUnique({ where: { id: params.id } });
    if (!account) throw new Error("Email account not found.");
    const health = await getAccountSendHealth(account.emailAddress);
    return jsonOk({ health });
  } catch (error) {
    return jsonError(error);
  }
}
