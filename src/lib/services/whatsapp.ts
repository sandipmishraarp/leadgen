import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logActivity } from "@/lib/services/activity";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const phonePattern = /^\+[1-9]\d{7,14}$/;

export function normalizeWhatsAppNumber(countryCode: string, number: string) {
  const raw = String(number || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  const code = String(countryCode || "").replace(/[^\d]/g, "");
  const local = raw.replace(/\D/g, "");
  return code ? `+${code}${local}` : local;
}

export function validateWhatsAppNumber(countryCode: string, number: string) {
  const normalized = normalizeWhatsAppNumber(countryCode, number);
  if (!countryCode?.trim()) return { valid: false, normalized, error: "Country code is required." };
  if (!phonePattern.test(normalized)) return { valid: false, normalized, error: "Use international format, for example +14155552671." };
  return { valid: true, normalized, error: "" };
}

export async function getWhatsAppSettings() {
  const delegate = whatsAppDelegate("whatsAppBusinessAccount");
  if (!delegate) return defaultWhatsAppSettings("WhatsApp database is not ready. Run Prisma generate/migration and restart the app.");
  try {
    const existing = await delegate.findFirst({ orderBy: { createdAt: "asc" } });
    return existing || delegate.create({ data: {} });
  } catch (error) {
    if (isMissingWhatsAppTableError(error)) {
      return defaultWhatsAppSettings("WhatsApp database tables are not ready. Run Prisma migration and restart the app.");
    }
    throw error;
  }
}

export async function saveWhatsAppSettings(input: Record<string, unknown>) {
  const existing = await getWhatsAppSettings();
  if (existing.id === "default") {
    throw new Error(existing.lastError || "WhatsApp database is not ready. Run Prisma migration and restart the app.");
  }
  const data: any = {
    enabled: Boolean(input.enabled),
    metaBusinessAccountId: stringOrNull(input.metaBusinessAccountId),
    phoneNumberId: stringOrNull(input.phoneNumberId),
    businessDisplayNumber: stringOrNull(input.businessDisplayNumber),
    webhookVerifyToken: stringOrNull(input.webhookVerifyToken),
    defaultCountry: stringOrNull(input.defaultCountry),
    dailySendLimit: Number(input.dailySendLimit || existing.dailySendLimit || 50),
    maxMessagesPerMinute: Number(input.maxMessagesPerMinute || existing.maxMessagesPerMinute || 5),
    businessHours: input.businessHours || existing.businessHours || undefined
  };
  if (typeof input.permanentAccessToken === "string" && input.permanentAccessToken.trim()) {
    data.accessTokenEncrypted = encryptSecret(input.permanentAccessToken.trim());
  }
  if (typeof input.appSecret === "string" && input.appSecret.trim()) data.appSecretEncrypted = encryptSecret(input.appSecret.trim());
  if (typeof input.webhookSecret === "string" && input.webhookSecret.trim()) data.webhookSecretEncrypted = encryptSecret(input.webhookSecret.trim());
  return prisma.whatsAppBusinessAccount.update({ where: { id: existing.id }, data });
}

export async function testWhatsAppConnection() {
  const account = await getWhatsAppSettings();
  if (account.id === "default") {
    throw new Error(account.lastError || "WhatsApp database is not ready. Run Prisma migration and restart the app.");
  }
  const token = account.accessTokenEncrypted ? decryptSecret(account.accessTokenEncrypted) : "";
  if (!account.phoneNumberId || !token) throw new Error("Phone Number ID and Permanent Access Token are required.");
  const response = await fetch(`${GRAPH_BASE}/${account.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Meta API failed with ${response.status}`;
    await prisma.whatsAppBusinessAccount.update({ where: { id: account.id }, data: { status: "FAILED", lastError: message, lastTestAt: new Date() } });
    throw new Error(message);
  }
  return prisma.whatsAppBusinessAccount.update({
    where: { id: account.id },
    data: { status: "CONNECTED", lastError: null, lastTestAt: new Date(), businessDisplayNumber: body.display_phone_number || account.businessDisplayNumber }
  }).then((updated) => ({ account: updated, meta: body }));
}

export async function upsertWhatsAppContact(leadId: string, input: Record<string, unknown>) {
  assertWhatsAppDelegate("whatsAppContact");
  const countryCode = String(input.countryCode || "");
  const number = String(input.whatsappNumber || "");
  const validation = number ? validateWhatsAppNumber(countryCode, number) : { valid: true, normalized: "", error: "" };
  if (!validation.valid) throw new Error(validation.error);
  const duplicate = validation.normalized
    ? await prisma.whatsAppContact.findFirst({ where: { whatsappNumber: validation.normalized, leadId: { not: leadId } }, include: { lead: true } })
    : null;
  const contact = await prisma.whatsAppContact.upsert({
    where: { leadId },
    create: {
      leadId,
      whatsappNumber: validation.normalized || null,
      countryCode: countryCode || null,
      preferredContactMethod: String(input.preferredContactMethod || "Email"),
      whatsappAvailable: String(input.whatsappAvailable || "Unknown"),
      contactVerified: Boolean(input.contactVerified),
      notes: stringOrNull(input.notes)
    },
    update: {
      whatsappNumber: validation.normalized || null,
      countryCode: countryCode || null,
      preferredContactMethod: String(input.preferredContactMethod || "Email"),
      whatsappAvailable: String(input.whatsappAvailable || "Unknown"),
      contactVerified: Boolean(input.contactVerified),
      notes: stringOrNull(input.notes)
    }
  });
  return { contact, warning: duplicate ? `This WhatsApp number is already used by ${duplicate.lead.name || duplicate.lead.email}.` : null };
}

export async function generateWhatsAppDraft(leadId: string, createdBy?: string) {
  assertWhatsAppDelegate("whatsAppMessage");
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      whatsappContact: true,
      threads: { include: { emails: { orderBy: { sentAt: "desc" }, take: 4 } }, orderBy: { lastMessageAt: "desc" }, take: 2 },
      whatsappMessages: { orderBy: { createdAt: "desc" }, take: 5 }
    }
  });
  if (!lead) throw new Error("Lead not found.");
  if (hasBlockSignal([lead.notes, ...lead.threads.flatMap((thread) => thread.emails.map((email) => `${email.subject}\n${email.textBody || email.snippet || ""}`))].join("\n"))) {
    throw new Error("WhatsApp draft blocked because this lead has a do-not-contact signal.");
  }
  const phone = lead.whatsappContact?.whatsappNumber || normalizeWhatsAppNumber(lead.whatsappContact?.countryCode || "", lead.phone || "");
  if (!phonePattern.test(phone)) throw new Error("Add a valid WhatsApp number before generating a WhatsApp draft.");
  const latestOutbound = lead.threads.flatMap((thread) => thread.emails).filter((email) => email.direction === "OUTBOUND").sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
  const body = buildWhatsAppDraftText(lead.name, lead.service, latestOutbound?.sentAt);
  const message = await prisma.whatsAppMessage.create({
    data: { leadId, phone, body, status: "DRAFT", createdBy }
  });
  await logActivity({ type: "DRAFT_GENERATED", message: "WhatsApp draft ready", leadId, metadata: { whatsappMessageId: message.id } });
  return message;
}

export async function sendWhatsAppMessage(messageId: string, userEmail?: string) {
  assertWhatsAppDelegate("whatsAppMessage");
  const [message, account] = await Promise.all([
    prisma.whatsAppMessage.findUnique({ where: { id: messageId }, include: { lead: true } }),
    getWhatsAppSettings()
  ]);
  if (!message) throw new Error("WhatsApp message not found.");
  if (!account.enabled) throw new Error("WhatsApp is disabled in Settings.");
  if (!account.phoneNumberId || !account.accessTokenEncrypted) throw new Error("WhatsApp Business connection is not configured.");
  if (hasBlockSignal(message.lead.notes || "")) throw new Error("WhatsApp send blocked by do-not-contact safety.");
  await enforceWhatsAppLimits(account.id, account.dailySendLimit, account.maxMessagesPerMinute);
  const token = decryptSecret(account.accessTokenEncrypted);
  const response = await fetch(`${GRAPH_BASE}/${account.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.phone.replace(/^\+/, ""),
      type: "text",
      text: { preview_url: false, body: message.body }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failureReason = body?.error?.message || `Meta API failed with ${response.status}`;
    await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: "FAILED", failureReason, apiResponse: body, retryCount: { increment: 1 } } });
    await logActivity({ type: "ERROR", message: "WhatsApp send failed", leadId: message.leadId, metadata: { whatsappMessageId: message.id, failureReason } });
    throw new Error(failureReason);
  }
  const metaMessageId = body?.messages?.[0]?.id || null;
  const updated = await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: { status: "SENT", businessAccountId: account.id, metaMessageId, apiResponse: body, sentAt: new Date(), createdBy: userEmail || message.createdBy }
  });
  await logActivity({ type: "EMAIL_SENT", message: "WhatsApp message sent", leadId: message.leadId, metadata: { whatsappMessageId: message.id, metaMessageId } });
  return updated;
}

export async function handleWhatsAppWebhook(payload: any) {
  assertWhatsAppDelegate("whatsAppMessage");
  const changes = payload?.entry?.flatMap((entry: any) => entry.changes || []) || [];
  for (const change of changes) {
    const value = change.value || {};
    for (const status of value.statuses || []) {
      const next: any = { apiResponse: status };
      if (status.status === "delivered") next.deliveredAt = new Date(Number(status.timestamp || Date.now() / 1000) * 1000);
      if (status.status === "read") next.readAt = new Date(Number(status.timestamp || Date.now() / 1000) * 1000);
      if (status.status === "failed") next.failureReason = status.errors?.[0]?.message || "WhatsApp delivery failed";
      next.status = String(status.status || "").toUpperCase();
      await prisma.whatsAppMessage.updateMany({ where: { metaMessageId: status.id }, data: next });
    }
    for (const incoming of value.messages || []) {
      const phone = `+${incoming.from}`;
      const contact = await prisma.whatsAppContact.findFirst({ where: { whatsappNumber: phone } });
      if (!contact) continue;
      const message = await prisma.whatsAppMessage.create({
        data: {
          leadId: contact.leadId,
          businessAccountId: accountIdFromPhoneNumber(value.metadata?.phone_number_id),
          direction: "INBOUND",
          phone,
          body: incoming.text?.body || "",
          status: "REPLIED",
          metaMessageId: incoming.id,
          receivedAt: new Date(Number(incoming.timestamp || Date.now() / 1000) * 1000),
          apiResponse: incoming
        }
      });
      await logActivity({ type: "MAIL_SYNC", message: "Client replied on WhatsApp", leadId: contact.leadId, metadata: { whatsappMessageId: message.id } });
    }
  }
}

export function publicWhatsAppSettings(account: Awaited<ReturnType<typeof getWhatsAppSettings>>) {
  return {
    id: account.id,
    enabled: account.enabled,
    label: account.label,
    metaBusinessAccountId: account.metaBusinessAccountId,
    phoneNumberId: account.phoneNumberId,
    businessDisplayNumber: account.businessDisplayNumber,
    accessTokenConfigured: Boolean(account.accessTokenEncrypted),
    appSecretConfigured: Boolean(account.appSecretEncrypted),
    webhookVerifyToken: account.webhookVerifyToken,
    webhookSecretConfigured: Boolean(account.webhookSecretEncrypted),
    defaultCountry: account.defaultCountry,
    businessHours: account.businessHours,
    dailySendLimit: account.dailySendLimit,
    maxMessagesPerMinute: account.maxMessagesPerMinute,
    status: account.status,
    lastTestAt: account.lastTestAt,
    lastError: account.lastError,
    updatedAt: account.updatedAt
  };
}

async function enforceWhatsAppLimits(accountId: string, dailyLimit: number, perMinute: number) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const minute = new Date(Date.now() - 60_000);
  const [today, recent] = await Promise.all([
    prisma.whatsAppMessage.count({ where: { businessAccountId: accountId, status: "SENT", sentAt: { gte: day } } }),
    prisma.whatsAppMessage.count({ where: { businessAccountId: accountId, status: "SENT", sentAt: { gte: minute } } })
  ]);
  if (today >= dailyLimit) throw new Error("Daily WhatsApp send limit exceeded.");
  if (recent >= perMinute) throw new Error("WhatsApp messages per minute limit exceeded.");
}

function buildWhatsAppDraftText(name?: string | null, service?: string | null, lastEmailDate?: Date | null) {
  const firstName = (name || "").split(" ")[0] || "there";
  const topic = service ? ` about your ${service}` : "";
  const reference = lastEmailDate ? "my previous email" : "your project";
  return `Hi ${firstName},\n\nHope you're doing well.\n\nJust following up regarding ${reference}${topic}. Happy to answer any questions if you're still exploring options.\n\nThanks,\nAbhay`.slice(0, 500);
}

function hasBlockSignal(value: string) {
  return /\b(do not contact|unsubscribe|stop emailing|remove me|not interested|delivery failed|bounce|invalid email)\b/i.test(value || "");
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountIdFromPhoneNumber(phoneNumberId?: string | null) {
  void phoneNumberId;
  return null;
}

function assertWhatsAppDelegate(name: "whatsAppBusinessAccount" | "whatsAppContact" | "whatsAppMessage") {
  if (!whatsAppDelegate(name)) {
    throw new Error("WhatsApp database is not ready. Please run Prisma generate and migration, then restart the app.");
  }
}

function whatsAppDelegate(name: "whatsAppBusinessAccount" | "whatsAppContact" | "whatsAppMessage") {
  return (prisma as any)[name] || null;
}

function isMissingWhatsAppTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("whatsapp_business_accounts")
    || message.includes("whatsapp_contacts")
    || message.includes("whatsapp_messages")
    || message.includes("does not exist in the current database")
    || message.includes("does not exist");
}

function defaultWhatsAppSettings(lastError: string | null = null) {
  return {
    id: "default",
    enabled: false,
    label: "AResourcePool WhatsApp",
    metaBusinessAccountId: null,
    phoneNumberId: null,
    businessDisplayNumber: null,
    accessTokenEncrypted: null,
    appSecretEncrypted: null,
    webhookVerifyToken: null,
    webhookSecretEncrypted: null,
    defaultCountry: null,
    businessHours: null,
    dailySendLimit: 50,
    maxMessagesPerMinute: 5,
    status: "DISCONNECTED",
    lastTestAt: null,
    lastError,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}
