import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { logActivity } from "@/lib/services/activity";
import { roleToAccountType, safeEmailAccount } from "@/lib/services/email-account-management";

const accountSchema = z.object({
  emailAddress: z.string().email(),
  role: z.enum(["Lead Intake", "Sales", "Marketing", "Support", "Admin", "Custom"]).default("Sales"),
  accountName: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().default(993),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().default(465),
  username: z.string().min(1),
  password: z.string().optional(),
  selectedFolders: z.array(z.string()).optional().default([]),
  importRange: z.string().optional().default("Last 30 Days"),
  customDateFrom: z.string().optional().nullable(),
  customDateTo: z.string().optional().nullable(),
  autoImport: z.boolean().optional().default(false),
  syncInterval: z.string().optional().default("Manual")
});

export async function GET() {
  try {
    await requireUser();
    const accounts = await prisma.emailAccount.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            emails: true,
            leadIntakes: true,
            leadImportJobs: true
          }
        },
        leadImportJobs: { orderBy: { createdAt: "desc" }, take: 3 }
      }
    });
    return jsonOk({ accounts: accounts.map(safeEmailAccount) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = accountSchema.parse(await request.json());
    const accountType = roleToAccountType(input.role);
    const encryptedPassword = input.password ? encryptSecret(input.password) : undefined;
    const folderConfig = {
      selectedFolders: input.selectedFolders,
      importRange: input.importRange,
      customDateFrom: input.customDateFrom,
      customDateTo: input.customDateTo
    };
    const schedulerConfig = {
      interval: input.syncInterval,
      autoImport: input.autoImport
    };

    const account = await prisma.emailAccount.upsert({
      where: { emailAddress: input.emailAddress },
      create: {
        label: input.accountName || input.emailAddress,
        emailAddress: input.emailAddress,
        accountType,
        role: input.role,
        description: input.description,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        imapUser: input.username,
        imapPasswordEncrypted: encryptedPassword || encryptSecret(""),
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpUser: input.username,
        smtpPasswordEncrypted: encryptedPassword || encryptSecret(""),
        folderConfig,
        schedulerConfig,
        status: "CONNECTED",
        isActive: true
      },
      update: {
        label: input.accountName || input.emailAddress,
        accountType,
        role: input.role,
        description: input.description,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        imapUser: input.username,
        ...(encryptedPassword ? { imapPasswordEncrypted: encryptedPassword, smtpPasswordEncrypted: encryptedPassword } : {}),
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpUser: input.username,
        folderConfig,
        schedulerConfig,
        status: "CONNECTED",
        disabledAt: null,
        isActive: true
      }
    });

    await logActivity({
      type: "SETTINGS_UPDATED",
      message: `Email account saved: ${account.emailAddress}`,
      userId: user.id,
      metadata: { accountId: account.id, role: input.role }
    });
    return jsonOk({ account: safeEmailAccount(account) });
  } catch (error) {
    return jsonError(error);
  }
}
