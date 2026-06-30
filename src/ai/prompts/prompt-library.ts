export const PROMPT_LIBRARY = {
  FIRST_DRAFT: "Write an approval-ready first sales reply. Use compact context only. Return JSON only.",
  FOLLOW_UP: "Write a short follow-up. Do not imply the client replied unless latest message is inbound. Return JSON only.",
  REWRITE: "Improve the selected email content while preserving meaning and useful HTML. Return JSON only.",
  GRAMMAR: "Fix grammar and clarity while preserving meaning and useful HTML. Return JSON only.",
  PROPOSAL: "Create a professional proposal draft from compact lead context. Return JSON only.",
  SUBJECT: "Generate or improve a concise email subject. Return JSON only.",
  CLIENT_BRAIN: "Create concise structured client memory. Use only provided data. Return JSON only."
} as const;
