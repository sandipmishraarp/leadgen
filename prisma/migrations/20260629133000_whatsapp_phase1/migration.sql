CREATE TABLE IF NOT EXISTS "whatsapp_business_accounts" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "label" TEXT NOT NULL DEFAULT 'AResourcePool WhatsApp',
  "metaBusinessAccountId" TEXT,
  "phoneNumberId" TEXT,
  "businessDisplayNumber" TEXT,
  "accessTokenEncrypted" TEXT,
  "appSecretEncrypted" TEXT,
  "webhookVerifyToken" TEXT,
  "webhookSecretEncrypted" TEXT,
  "defaultCountry" TEXT,
  "businessHours" JSONB,
  "dailySendLimit" INTEGER NOT NULL DEFAULT 50,
  "maxMessagesPerMinute" INTEGER NOT NULL DEFAULT 5,
  "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
  "lastTestAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_business_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_business_accounts_enabled_status_idx" ON "whatsapp_business_accounts"("enabled", "status");

CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "whatsappNumber" TEXT,
  "countryCode" TEXT,
  "preferredContactMethod" TEXT NOT NULL DEFAULT 'Email',
  "whatsappAvailable" TEXT NOT NULL DEFAULT 'Unknown',
  "contactVerified" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_contacts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contacts_leadId_key" ON "whatsapp_contacts"("leadId");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_whatsappNumber_idx" ON "whatsapp_contacts"("whatsappNumber");

CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "businessAccountId" TEXT,
  "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
  "messageType" TEXT NOT NULL DEFAULT 'TEXT',
  "phone" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "metaMessageId" TEXT,
  "apiResponse" JSONB,
  "failureReason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "whatsapp_messages_leadId_createdAt_idx" ON "whatsapp_messages"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_scheduledAt_idx" ON "whatsapp_messages"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_phone_idx" ON "whatsapp_messages"("phone");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_metaMessageId_idx" ON "whatsapp_messages"("metaMessageId");
