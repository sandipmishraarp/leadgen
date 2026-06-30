import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { safeEmailAccount } from "@/lib/services/email-account-management";

const fallbackAccounts = [
  { id: "lead", emailAddress: "lead@aresourcepool.com", role: "Lead Intake", label: "Lead", status: "AVAILABLE", accountType: "LEAD_INTAKE" },
  { id: "abhay", emailAddress: "abhay@aresourcepool.com", role: "Sales", label: "Abhay", status: "AVAILABLE", accountType: "SALES_SENDER" },
  { id: "parmeet", emailAddress: "parmeet@aresourcepool.com", role: "Sales", label: "Parmeet", status: "AVAILABLE", accountType: "SALES_SENDER" },
  { id: "karan", emailAddress: "karan@aresourcepool.com", role: "Sales", label: "Karan", status: "AVAILABLE", accountType: "SALES_SENDER" },
  { id: "marketing", emailAddress: "marketing@aresourcepool.com", role: "Marketing", label: "Marketing", status: "AVAILABLE", accountType: "SALES_SENDER" },
  { id: "support", emailAddress: "support@aresourcepool.com", role: "Support", label: "Support", status: "AVAILABLE", accountType: "SALES_SENDER" }
];

export async function GET() {
  try {
    await requireUser();
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true },
      orderBy: [{ role: "asc" }, { emailAddress: "asc" }]
    });
    const configured = accounts.map(safeEmailAccount);
    const configuredEmails = new Set(configured.map((account) => account.emailAddress.toLowerCase()));
    const fallbacks = fallbackAccounts.filter((account) => !configuredEmails.has(account.emailAddress.toLowerCase()));
    return jsonOk({ accounts: [...configured, ...fallbacks] });
  } catch (error) {
    return jsonError(error);
  }
}
