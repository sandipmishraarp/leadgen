import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assignedLeadWhereForMailbox, resolveMailboxContext } from "@/lib/services/mailbox-filter";

const statusSchema = z
  .enum([
    "WAITING_FOR_SANDIP",
    "APPROVED",
    "REJECTED",
    "HOLD",
    "ARCHIVED",
    "CONTACTED",
    "NEW",
    "DRAFT_CREATED",
    "REPLIED",
    "FOLLOW_UP_NEEDED",
    "PROPOSAL_SENT",
    "WON",
    "LOST"
  ])
  .optional();

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const status = statusSchema.parse(searchParams.get("status") || undefined);
    const mailboxParam = searchParams.get("mailbox") || searchParams.get("activeAccountEmail");
    const mailbox = mailboxParam ? await resolveMailboxContext(mailboxParam, "abhay@aresourcepool.com") : null;
    const leads = await prisma.lead.findMany({
      where: {
        AND: [
          ...(status ? [{ status }] : []),
          ...(mailbox ? [assignedLeadWhereForMailbox(mailbox)] : [])
        ]
      },
      orderBy: { updatedAt: "desc" },
      include: {
        threads: {
          orderBy: { lastMessageAt: "desc" },
          take: 1
        }
      }
    });
    return jsonOk({ leads });
  } catch (error) {
    return jsonError(error);
  }
}
