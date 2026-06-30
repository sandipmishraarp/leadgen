import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { roleToAccountType, safeEmailAccount } from "@/lib/services/email-account-management";

const updateSchema = z.object({
  label: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional().nullable(),
  folderConfig: z.unknown().optional(),
  schedulerConfig: z.unknown().optional(),
  excludedDomains: z.array(z.string()).optional(),
  excludedEmails: z.array(z.string()).optional(),
  internalDomain: z.string().optional(),
  autoSyncEnabled: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const account = await prisma.emailAccount.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { emails: true, leadIntakes: true, leadImportJobs: true } },
        leadImportJobs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { folders: { orderBy: { folderPath: "asc" } } }
        }
      }
    });
    if (!account) throw new Error("Email account not found");
    return jsonOk({ account: safeEmailAccount(account) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const input = updateSchema.parse(await request.json());
    const account = await prisma.emailAccount.update({
      where: { id: params.id },
      data: {
        label: input.label,
        role: input.role,
        accountType: input.role ? roleToAccountType(input.role) : undefined,
        status: input.status,
        description: input.description,
        folderConfig: input.folderConfig as any,
        schedulerConfig: input.schedulerConfig as any,
        excludedDomains: input.excludedDomains,
        excludedEmails: input.excludedEmails,
        internalDomain: input.internalDomain,
        autoSyncEnabled: input.autoSyncEnabled,
        isActive: input.isActive,
        disabledAt: input.isActive === false ? new Date() : input.isActive === true ? null : undefined
      }
    });
    return jsonOk({ account: safeEmailAccount(account) });
  } catch (error) {
    return jsonError(error);
  }
}
