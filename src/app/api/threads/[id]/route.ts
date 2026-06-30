import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const thread = await prisma.emailThread.findUnique({
      where: { id: params.id },
      include: {
        lead: true,
        emails: { orderBy: { sentAt: "asc" } },
        drafts: { orderBy: { createdAt: "desc" } },
        sentEmails: { orderBy: { sentAt: "desc" } }
      }
    });
    if (!thread) return jsonOk({ error: "Thread not found" }, { status: 404 });
    return jsonOk({ thread });
  } catch (error) {
    return jsonError(error);
  }
}
