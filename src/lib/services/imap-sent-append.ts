import { ImapFlow } from "imapflow";
import type { EmailAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountSecrets } from "@/lib/services/account";
import { logActivity } from "@/lib/services/activity";

const SENT_FOLDER_CANDIDATES = ["Sent", "Sent Items", "INBOX.Sent", "Sent Messages", "Sent Mail"];

function createClient(account: EmailAccount, password: string) {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    logger: false,
    auth: {
      user: account.imapUser,
      pass: password
    }
  });
}

async function detectSentFolder(client: ImapFlow, configured?: string | null) {
  if (configured) return configured;
  const mailboxes = await client.list();
  const paths = mailboxes.map((mailbox: any) => String(mailbox.path || mailbox.name || ""));
  return SENT_FOLDER_CANDIDATES.find((candidate) => paths.includes(candidate)) || paths.find((path) => /sent/i.test(path)) || "Sent";
}

function extractAppendUid(result: unknown) {
  const value = result as { uid?: unknown; uidValidity?: unknown; destination?: unknown } | undefined;
  if (!value) return null;
  if (value.uid !== undefined && value.uid !== null) return String(value.uid);
  return null;
}

export async function appendSentEmailToImap(sentEmailId: string) {
  const sentEmail = await prisma.sentEmail.findUnique({
    where: { id: sentEmailId },
    include: { thread: { include: { account: true } } }
  });
  if (!sentEmail) throw new Error("Sent email not found.");
  if (!sentEmail.rawMime) throw new Error("Raw sent message is not available for IMAP append.");

  const account = sentEmail.thread.account;
  const { imapPassword } = accountSecrets(account);
  const client = createClient(account, imapPassword);
  const folder = await runAppend(client, account, sentEmail.rawMime, sentEmail.sentAt);

  await prisma.sentEmail.update({
    where: { id: sentEmail.id },
    data: {
      imapUid: folder.uid,
      sentFolder: folder.folder,
      appendedAt: new Date(),
      appendStatus: "APPENDED",
      appendError: null
    }
  });

  await logActivity({
    type: "MAIL_SYNC",
    message: `Copied sent email to IMAP Sent folder ${folder.folder}`,
    threadId: sentEmail.threadId,
    metadata: { sentEmailId: sentEmail.id, folder: folder.folder, imapUid: folder.uid }
  });

  return folder;
}

export async function markSentAppendFailed(sentEmailId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.sentEmail.update({
    where: { id: sentEmailId },
    data: {
      appendStatus: "FAILED",
      appendError: message
    }
  });
  return message;
}

async function runAppend(client: ImapFlow, account: EmailAccount, rawMime: string, sentAt: Date) {
  await client.connect();
  try {
    const folder = await detectSentFolder(client, account.sentFolder);
    const result = await client.append(folder, Buffer.from(rawMime), ["\\Seen"], sentAt);
    return {
      folder,
      uid: extractAppendUid(result)
    };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
