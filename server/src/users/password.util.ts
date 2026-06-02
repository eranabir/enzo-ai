import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash a secret (password or PIN) with scrypt + a random salt.
 * Stored as "salt:derivedKey" (both hex). No external dependency.
 */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Constant-time verification of a secret against a stored hash. */
export function verifySecret(secret: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const derived = scryptSync(secret, Buffer.from(saltHex, "hex"), key.length);
  return key.length === derived.length && timingSafeEqual(key, derived);
}
