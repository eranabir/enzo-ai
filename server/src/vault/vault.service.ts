import { Injectable, Logger } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { SettingsService } from "../settings/settings.service";

const ALGO = "aes-256-gcm" as const;
const ENC_PREFIX = "enc:v1:"; // marks an encrypted field value on disk

// Settings keys for the (non-secret) vault metadata. The wrapped DEK is safe to
// store — it can't be unwrapped without the passphrase or recovery key.
const K = {
  enabled:  "vault_enabled",
  passSalt: "vault_pass_salt",
  recSalt:  "vault_rec_salt",
  dekByPass:"vault_dek_by_pass",
  dekByRec: "vault_dek_by_rec",
};

/**
 * Envelope encryption for the user's data ("the vault").
 *
 * A random 256-bit Data Encryption Key (DEK) encrypts chat content, titles and
 * memories. The DEK itself is wrapped (AES-256-GCM) twice and stored on disk:
 * once under a key derived from the admin passphrase, once under a key derived
 * from a recovery key. The passphrase / recovery key / raw DEK are NEVER
 * written to disk — the DEK only ever lives in memory after an unlock.
 *
 * Unlock sources, in order, at boot: ENZO_PASSPHRASE / ENZO_PASSPHRASE_FILE
 * (for headless Docker/NAS), otherwise an interactive unlock via the API.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private dek: Buffer | null = null;
  private readonly onUnlockHooks: Array<() => void> = [];

  constructor(private readonly settings: SettingsService) {}

  // ── State ───────────────────────────────────────────────────────────────────

  /** Has the admin turned on encryption? */
  isConfigured(): boolean {
    return this.settings.get(K.enabled) === "1";
  }

  /** Is the DEK currently in memory (data readable/writable)? */
  isUnlocked(): boolean {
    return this.dek !== null;
  }

  /** Ready = no encryption, or encryption that's currently unlocked. */
  isReady(): boolean {
    return !this.isConfigured() || this.isUnlocked();
  }

  status(): { configured: boolean; unlocked: boolean } {
    return { configured: this.isConfigured(), unlocked: this.isUnlocked() };
  }

  /** Register a callback to run whenever the vault transitions to unlocked. */
  onUnlock(fn: () => void): void {
    this.onUnlockHooks.push(fn);
  }

  // ── Setup / unlock / change ─────────────────────────────────────────────────

  /**
   * First-time setup: generate the DEK, wrap it under the passphrase and a fresh
   * recovery key, persist the wraps, and leave the vault unlocked. Returns the
   * recovery key — shown to the admin ONCE and never stored in plaintext.
   */
  setup(passphrase: string): { recoveryKey: string } {
    if (this.isConfigured()) throw new Error("Encryption is already set up.");
    if (!passphrase || passphrase.length < 6) {
      throw new Error("Passphrase must be at least 6 characters.");
    }

    const dek = randomBytes(32);
    const recoveryKey = randomBytes(24).toString("base64url"); // ~32 chars, single token
    const passSalt = randomBytes(16);
    const recSalt = randomBytes(16);

    this.settings.set(K.passSalt, passSalt.toString("hex"));
    this.settings.set(K.recSalt, recSalt.toString("hex"));
    this.settings.set(K.dekByPass, this.wrap(dek, this.deriveKey(passphrase, passSalt)));
    this.settings.set(K.dekByRec, this.wrap(dek, this.deriveKey(recoveryKey, recSalt)));
    this.settings.set(K.enabled, "1");

    this.dek = dek;
    this.fireUnlock();
    this.logger.log("Vault configured and unlocked.");
    return { recoveryKey };
  }

  /** Unlock with either the passphrase or the recovery key. Throws if neither matches. */
  unlock(secret: string): void {
    if (!this.isConfigured()) throw new Error("Encryption is not set up.");
    if (this.isUnlocked()) return;

    const passSalt = Buffer.from(this.settings.get(K.passSalt) ?? "", "hex");
    const recSalt = Buffer.from(this.settings.get(K.recSalt) ?? "", "hex");
    const wrappedPass = this.settings.get(K.dekByPass) ?? "";
    const wrappedRec = this.settings.get(K.dekByRec) ?? "";

    let dek: Buffer | null = null;
    try { dek = this.unwrap(wrappedPass, this.deriveKey(secret, passSalt)); } catch { /* not the passphrase */ }
    if (!dek) {
      try { dek = this.unwrap(wrappedRec, this.deriveKey(secret, recSalt)); } catch { /* not the recovery key */ }
    }
    if (!dek) throw new Error("Incorrect passphrase or recovery key.");

    this.dek = dek;
    this.fireUnlock();
    this.logger.log("Vault unlocked.");
  }

  /** Forget the in-memory DEK. Data becomes unreadable until the next unlock. */
  lock(): void {
    this.dek = null;
    this.logger.log("Vault locked.");
  }

  /** Re-wrap the DEK under a new passphrase. Must be unlocked. */
  changePassphrase(newPassphrase: string): void {
    if (!this.isUnlocked() || !this.dek) throw new Error("Unlock the vault before changing the passphrase.");
    if (!newPassphrase || newPassphrase.length < 6) throw new Error("Passphrase must be at least 6 characters.");
    const passSalt = randomBytes(16);
    this.settings.set(K.passSalt, passSalt.toString("hex"));
    this.settings.set(K.dekByPass, this.wrap(this.dek, this.deriveKey(newPassphrase, passSalt)));
    this.logger.log("Vault passphrase changed.");
  }

  /** Try to auto-unlock from the environment (headless Docker/NAS). */
  tryAutoUnlock(): void {
    if (!this.isConfigured() || this.isUnlocked()) return;
    const fromFile = process.env.ENZO_PASSPHRASE_FILE
      ? this.readSecretFile(process.env.ENZO_PASSPHRASE_FILE)
      : null;
    const secret = fromFile ?? process.env.ENZO_PASSPHRASE ?? null;
    if (!secret) return;
    try {
      this.unlock(secret);
      this.logger.log("Vault auto-unlocked from environment.");
    } catch {
      this.logger.warn("ENZO_PASSPHRASE was set but did not unlock the vault.");
    }
  }

  // ── Field encryption (used by data services) ─────────────────────────────────

  /** Encrypt a field for storage. No-op (returns plaintext) when encryption is off. */
  encryptField(text: string): string {
    if (!this.isConfigured()) return text;
    if (!this.dek) throw new VaultLockedError();
    const iv = randomBytes(12);
    const c = createCipheriv(ALGO, this.dek, iv);
    const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
    const tag = c.getAuthTag();
    return ENC_PREFIX + [iv, tag, ct].map((b) => b.toString("hex")).join(":");
  }

  /** Decrypt a stored field. Passes through legacy plaintext; returns a lock marker if locked. */
  decryptField(stored: string | null | undefined): string {
    if (stored == null) return stored as any;
    if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy / unencrypted value
    if (!this.dek) return "🔒";
    try {
      const [ivH, tagH, ctH] = stored.slice(ENC_PREFIX.length).split(":");
      const d = createDecipheriv(ALGO, this.dek, Buffer.from(ivH, "hex"));
      d.setAuthTag(Buffer.from(tagH, "hex"));
      return Buffer.concat([d.update(Buffer.from(ctH, "hex")), d.final()]).toString("utf8");
    } catch {
      return "🔒";
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private deriveKey(secret: string, salt: Buffer): Buffer {
    return scryptSync(secret, salt, 32) as Buffer;
  }

  private wrap(dek: Buffer, kek: Buffer): string {
    const iv = randomBytes(12);
    const c = createCipheriv(ALGO, kek, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    const tag = c.getAuthTag();
    return [iv, tag, ct].map((b) => b.toString("hex")).join(":");
  }

  private unwrap(encoded: string, kek: Buffer): Buffer {
    const [ivH, tagH, ctH] = encoded.split(":");
    const d = createDecipheriv(ALGO, kek, Buffer.from(ivH, "hex"));
    d.setAuthTag(Buffer.from(tagH, "hex"));
    return Buffer.concat([d.update(Buffer.from(ctH, "hex")), d.final()]); // throws on wrong key
  }

  private readSecretFile(path: string): string | null {
    try { return readFileSync(path, "utf8").trim() || null; } catch { return null; }
  }

  private fireUnlock(): void {
    for (const fn of this.onUnlockHooks) {
      try { fn(); } catch (e) { this.logger.error(`onUnlock hook failed: ${(e as Error).message}`); }
    }
  }
}

/** Thrown when a write is attempted while the vault is configured but locked. */
export class VaultLockedError extends Error {
  constructor() {
    super("The vault is locked. Unlock it to read or write encrypted data.");
    this.name = "VaultLockedError";
  }
}
