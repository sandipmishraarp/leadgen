import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";

const schema = z.object({
  emailAddress: z.string().email(),
  accountType: z.enum(["LEAD_INTAKE", "SALES_SENDER", "ADMIN"]).default("SALES_SENDER"),
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int(),
  imapUser: z.string().min(1),
  imapPassword: z.string().optional(),
  inboxFolder: z.string().min(1).default("INBOX"),
  sentFolder: z.string().optional().nullable(),
  fetchLimit: z.coerce.number().int().min(50).max(500).default(50),
  autoSyncEnabled: z.coerce.boolean().optional().default(false),
  excludedDomains: z.string().optional(),
  excludedEmails: z.string().optional(),
  internalDomain: z.string().min(1).default("aresourcepool.com"),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int(),
  smtpUser: z.string().min(1),
  smtpPassword: z.string().optional(),
  openaiKey: z.string().optional()
});

export async function GET() {
  try {
    await requireUser();
    const account = await prisma.emailAccount.findFirst({ where: { isActive: true } });
    return jsonOk({
      account: account
        ? {
            ...account,
            imapPasswordEncrypted: undefined,
            smtpPasswordEncrypted: undefined,
            openaiApiKeyEncrypted: undefined,
            hasImapPassword: Boolean(account.imapPasswordEncrypted),
            hasSmtpPassword: Boolean(account.smtpPasswordEncrypted),
            hasOpenAIKey: Boolean(account.openaiApiKeyEncrypted || process.env.OPENAI_API_KEY)
          }
        : null
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const existing = await prisma.emailAccount.findFirst({ where: { isActive: true } });
    const account = await prisma.emailAccount.upsert({
      where: { emailAddress: input.emailAddress },
      create: {
        emailAddress: input.emailAddress,
        accountType: input.accountType,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        imapUser: input.imapUser,
        imapPasswordEncrypted: encryptSecret(input.imapPassword || ""),
        inboxFolder: input.inboxFolder,
        sentFolder: input.sentFolder || undefined,
        fetchLimit: input.fetchLimit,
        autoSyncEnabled: input.autoSyncEnabled,
        excludedDomains: splitList(input.excludedDomains),
        excludedEmails: splitList(input.excludedEmails),
        internalDomain: input.internalDomain,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpUser: input.smtpUser,
        smtpPasswordEncrypted: encryptSecret(input.smtpPassword || ""),
        openaiApiKeyEncrypted: input.openaiKey ? encryptSecret(input.openaiKey) : undefined
      },
      update: {
        imapHost: input.imapHost,
        accountType: input.accountType,
        imapPort: input.imapPort,
        imapUser: input.imapUser,
        imapPasswordEncrypted: input.imapPassword
          ? encryptSecret(input.imapPassword)
          : existing?.imapPasswordEncrypted,
        inboxFolder: input.inboxFolder,
        sentFolder: input.sentFolder || existing?.sentFolder,
        fetchLimit: input.fetchLimit,
        autoSyncEnabled: input.autoSyncEnabled,
        excludedDomains: splitList(input.excludedDomains),
        excludedEmails: splitList(input.excludedEmails),
        internalDomain: input.internalDomain,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpUser: input.smtpUser,
        smtpPasswordEncrypted: input.smtpPassword
          ? encryptSecret(input.smtpPassword)
          : existing?.smtpPasswordEncrypted,
        openaiApiKeyEncrypted: input.openaiKey
          ? encryptSecret(input.openaiKey)
          : existing?.openaiApiKeyEncrypted,
        isActive: true
      }
    });
    await logActivity({
      type: "SETTINGS_UPDATED",
      message: "Email settings updated",
      userId: user.id,
      metadata: { emailAddress: account.emailAddress }
    });
    return jsonOk({ account: { id: account.id, emailAddress: account.emailAddress } });
  } catch (error) {
    return jsonError(error);
  }
}

function splitList(value?: string) {
  return (value || "")
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
