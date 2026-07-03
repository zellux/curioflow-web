import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET_PREFIX = "enc:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionSecret() {
  return process.env.CURIOFLOW_SECRET_KEY?.trim() || null;
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

export function hasSecretEncryptionKey() {
  return Boolean(encryptionSecret());
}

export function isEncryptedSecret(value: string | null | undefined) {
  return Boolean(value?.startsWith(`${SECRET_PREFIX}:`));
}

export function requireSecretEncryptionKeyForWrite() {
  if (process.env.NODE_ENV !== "production" || hasSecretEncryptionKey()) return;
  throw new Error("CURIOFLOW_SECRET_KEY is required before storing API keys in production.");
}

export function sealSecret(plaintext: string) {
  const secret = encryptionSecret();
  if (!secret) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_PREFIX,
    base64UrlEncode(iv),
    base64UrlEncode(tag),
    base64UrlEncode(ciphertext)
  ].join(":");
}

export function openSecret(value: string | null | undefined) {
  if (!value) return null;
  if (!isEncryptedSecret(value)) return value;

  const secret = encryptionSecret();
  if (!secret) {
    throw new Error("Encrypted secret cannot be decrypted. Set CURIOFLOW_SECRET_KEY.");
  }

  const [, version, encodedIv, encodedTag, encodedCiphertext] = value.split(":");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Encrypted secret has an unsupported format.");
  }

  const iv = base64UrlDecode(encodedIv);
  const tag = base64UrlDecode(encodedTag);
  const ciphertext = base64UrlDecode(encodedCiphertext);

  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
    throw new Error("Encrypted secret has invalid metadata.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function secretsMatch(left: string | null | undefined, right: string | null | undefined) {
  const leftValue = openSecret(left);
  const rightValue = openSecret(right);
  if (!leftValue || !rightValue) return leftValue === rightValue;

  const leftBuffer = Buffer.from(leftValue);
  const rightBuffer = Buffer.from(rightValue);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
