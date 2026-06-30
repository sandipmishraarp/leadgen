import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { testImapConnection } from "@/lib/services/imap";
import { testSmtpConnection } from "@/lib/services/smtp";

export async function POST() {
  try {
    await requireUser();
    await testImapConnection();
    await testSmtpConnection();
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
