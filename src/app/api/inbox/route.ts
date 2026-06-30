import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { resolveMailboxContext, threadWhereForMailbox } from "@/lib/services/mailbox-filter";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const mailbox = await resolveMailboxContext(searchParams.get("mailbox") || searchParams.get("activeAccountEmail"), "abhay@aresourcepool.com");
    const threads = await prisma.emailThread.findMany({
      where: threadWhereForMailbox(mailbox),
      orderBy: { lastMessageAt: "desc" },
      include: {
        lead: true,
        emails: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            direction: true,
            fromName: true,
            fromEmail: true,
            toEmails: true,
            subject: true,
            snippet: true,
            folder: true,
            sourceFolder: true,
            sourceFolderPath: true,
            sentAt: true,
            isAutoReply: true,
            isBounce: true
          }
        },
        drafts: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    return jsonOk({ threads });
  } catch (error) {
    return jsonError(error);
  }
}
