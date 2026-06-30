export function roleToAccountType(role: string) {
  if (role === "Lead Intake") return "LEAD_INTAKE" as const;
  if (role === "Admin") return "ADMIN" as const;
  return "SALES_SENDER" as const;
}

export function safeEmailAccount(account: any) {
  const {
    imapPasswordEncrypted,
    smtpPasswordEncrypted,
    openaiApiKeyEncrypted,
    ...safe
  } = account;
  return {
    ...safe,
    hasImapPassword: Boolean(imapPasswordEncrypted),
    hasSmtpPassword: Boolean(smtpPasswordEncrypted),
    hasOpenAIKey: Boolean(openaiApiKeyEncrypted || process.env.OPENAI_API_KEY)
  };
}
