import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export async function getActiveAccount() {
  return getAccountByType("SALES_SENDER");
}

export async function getAbhaySenderAccount() {
  const account = await prisma.emailAccount.findFirst({
    where: {
      isActive: true,
      accountType: "SALES_SENDER",
      emailAddress: "abhay@aresourcepool.com"
    },
    orderBy: { createdAt: "asc" }
  });
  if (!account) {
    throw new Error("Configure active SALES_SENDER account for abhay@aresourcepool.com before sending.");
  }
  return account;
}

export async function getSenderAccountForLead(lead?: { assignedEmailAccount?: string | null } | null) {
  if (lead?.assignedEmailAccount) {
    const account = await prisma.emailAccount.findFirst({
      where: {
        isActive: true,
        emailAddress: { equals: lead.assignedEmailAccount, mode: "insensitive" }
      },
      orderBy: { createdAt: "asc" }
    });
    if (account) return account;
  }
  return getAbhaySenderAccount();
}

export async function getAccountByType(accountType: "LEAD_INTAKE" | "SALES_SENDER" | "ADMIN") {
  const account = await prisma.emailAccount.findFirst({
    where: { isActive: true, accountType },
    orderBy: { createdAt: "asc" }
  });

  if (account) return account;

  const fallback = await prisma.emailAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" }
  });

  if (fallback) return fallback;

  const required = [
    "IMAP_HOST",
    "IMAP_USER",
    "IMAP_PASSWORD",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD"
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Configure email settings first. Missing: ${missing.join(", ")}`);
  }

  return prisma.emailAccount.create({
    data: {
      emailAddress: process.env.IMAP_USER || "abhay@aresourcepool.com",
      accountType: "SALES_SENDER",
      imapHost: process.env.IMAP_HOST || "",
      imapPort: Number(process.env.IMAP_PORT || 993),
      imapUser: process.env.IMAP_USER || "",
      imapPasswordEncrypted: encryptSecret(process.env.IMAP_PASSWORD || ""),
      smtpHost: process.env.SMTP_HOST || "",
      smtpPort: Number(process.env.SMTP_PORT || 465),
      smtpUser: process.env.SMTP_USER || "",
      smtpPasswordEncrypted: encryptSecret(process.env.SMTP_PASSWORD || "")
    }
  });
}

export function accountSecrets(account: Awaited<ReturnType<typeof getActiveAccount>>) {
  return {
    imapPassword: decryptSecret(account.imapPasswordEncrypted),
    smtpPassword: decryptSecret(account.smtpPasswordEncrypted),
    openaiApiKey: account.openaiApiKeyEncrypted
      ? decryptSecret(account.openaiApiKeyEncrypted)
      : process.env.OPENAI_API_KEY || ""
  };
}
