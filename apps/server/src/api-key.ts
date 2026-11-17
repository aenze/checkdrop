import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX_PATTERN = /^(cdp_[a-f0-9]{12})_[A-Za-z0-9_-]{32,}$/;

export interface GeneratedPilotApiKey {
  readonly key: string;
  readonly prefix: string;
  readonly verifier: string;
}

export function generatePilotApiKey(): GeneratedPilotApiKey {
  const prefix = `cdp_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const key = `${prefix}_${secret}`;
  return { key, prefix, verifier: hashApiKey(key) };
}

export function extractApiKeyPrefix(key: string): string | null {
  return KEY_PREFIX_PATTERN.exec(key)?.[1] ?? null;
}

export function hashApiKey(key: string): string {
  return `sha256:${createHash("sha256").update(key, "utf8").digest("hex")}`;
}

export function verifyApiKey(key: string, verifier: string): boolean {
  const candidate = Buffer.from(hashApiKey(key));
  const stored = Buffer.from(verifier);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function hashIdempotencyKey(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}
