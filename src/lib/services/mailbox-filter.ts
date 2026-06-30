import { prisma } from "@/lib/prisma";

export type MailboxContext = {
  email: string;
  role: string;
  accountId: string | null;
};

export async function resolveMailboxContext(
  mailbox: string | undefined | null,
  fallbackEmail: string
): Promise<MailboxContext> {
  const email = decodeURIComponent(mailbox || fallbackEmail).trim().toLowerCase();
  const account = await prisma.emailAccount.findFirst({
    where: { emailAddress: { equals: email, mode: "insensitive" } },
    select: { id: true, emailAddress: true, role: true, accountType: true }
  });
  return {
    email: account?.emailAddress || email,
    role: account?.role || (email.startsWith("lead@") ? "Lead Intake" : "Sales"),
    accountId: account?.id || null
  };
}

export function isLeadIntakeMailbox(context: MailboxContext) {
  if (context.role === "Lead Intake") return true;
  if (context.role && context.role !== "Lead Intake") return false;
  return context.email.toLowerCase().startsWith("lead@");
}

export function assertLeadIntakeMailbox(context: MailboxContext) {
  if (!isLeadIntakeMailbox(context)) {
    const error = new Error("This endpoint is only available for Lead Intake accounts.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
}

export function leadIntakeWhereForMailbox(context: MailboxContext, status?: string, extraWhere: Record<string, unknown> = {}) {
  return {
    ...(status ? { status: status as any } : {}),
    ...extraWhere,
    OR: [
      { accountEmail: { equals: context.email, mode: "insensitive" as const } },
      { account: { emailAddress: { equals: context.email, mode: "insensitive" as const } } },
      ...(context.accountId ? [{ accountId: context.accountId }] : [])
    ]
  };
}

export function emailWhereForMailbox(context: MailboxContext) {
  return context.accountId
    ? { accountId: context.accountId }
    : {
        account: { emailAddress: { equals: context.email, mode: "insensitive" as const } }
      };
}

export function threadWhereForMailbox(context: MailboxContext) {
  return context.accountId
    ? { accountId: context.accountId }
    : {
        account: { emailAddress: { equals: context.email, mode: "insensitive" as const } }
      };
}

export function assignedLeadWhereForMailbox(context: MailboxContext) {
  return {
    OR: [
      { currentMailbox: { equals: context.email, mode: "insensitive" as const } },
      { assignedEmailAccount: { equals: context.email, mode: "insensitive" as const } }
    ]
  };
}
