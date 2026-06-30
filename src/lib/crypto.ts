import crypto from "crypto";

const algorithm = "aes-256-gcm";
const activeSecret = process.env.APP_SECRET || "dev-secret";
const key = deriveKey(activeSecret);

function deriveKey(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(value: string): string {
  if (!value) return "";
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return value;
  const candidateKeys = [key];

  // Local dev originally booted once with the implicit fallback secret. Keep
  // existing saved credentials readable after .env is introduced.
  if (activeSecret !== "dev-secret") {
    candidateKeys.push(deriveKey("dev-secret"));
  }

  for (const candidateKey of candidateKeys) {
    try {
      const decipher = crypto.createDecipheriv(algorithm, candidateKey, Buffer.from(ivRaw, "base64"));
      decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, "base64")),
        decipher.final()
      ]).toString("utf8");
    } catch {
      // Try the next candidate key before surfacing a friendly error.
    }
  }

  throw new Error("Saved secret could not be decrypted. Re-enter the affected key or password in Settings.");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split("$")[2];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

export function signToken(payload: Record<string, string>, maxAgeSeconds = 60 * 60 * 8): string {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signature = crypto.createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyToken(token?: string): Record<string, string> | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", key).update(encoded).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, string>;
  if (Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
