import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { logActivity } from "@/lib/services/activity";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const account = await prisma.emailAccount.findUnique({ where: { id: params.id } });
    if (!account) throw new Error("Email account not found");

    const imapPassword = decryptSecret(account.imapPasswordEncrypted);
    const smtpPassword = decryptSecret(account.smtpPasswordEncrypted);
    const imap = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      logger: false,
      auth: { user: account.imapUser, pass: imapPassword }
    });
    await imap.connect();
    await imap.logout();

    const smtp = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.smtpUser, pass: smtpPassword }
    });
    await smtp.verify();

    const updated = await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        lastTestAt: new Date(),
        status: "CONNECTED",
        connectionStatus: { imap: "ok", smtp: "ok", testedAt: new Date().toISOString() }
      }
    });
    await logActivity({
      type: "MAIL_SYNC",
      message: `Connection tested for ${account.emailAddress}`,
      metadata: { accountId: account.id }
    });
    return jsonOk({ ok: true, testedAt: updated.lastTestAt });
  } catch (error) {
    await prisma.emailAccount.update({
      where: { id: params.id },
      data: {
        status: "ERROR",
        connectionStatus: {
          error: error instanceof Error ? error.message : String(error),
          testedAt: new Date().toISOString()
        }
      }
    }).catch(() => null);
    return jsonError(error);
  }
}
