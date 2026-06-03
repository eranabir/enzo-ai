import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { config } from "../config";

export type Provider = "openai" | "anthropic" | "google";

const ALGO = "aes-256-gcm" as const;

// ── Encryption helpers ────────────────────────────────────────────────────────

function masterKey(): Buffer {
  const keyFile = join(config.dataDir, "master.key");
  mkdirSync(config.dataDir, { recursive: true });
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  const hex = readFileSync(keyFile, "utf-8").trim();
  return scryptSync(hex, "enzo-ai-key-salt-v1", 32) as Buffer;
}

function encrypt(text: string): string {
  const key = masterKey();
  const iv  = randomBytes(16);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(text, "utf-8"), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("hex")).join(":");
}

function decrypt(encoded: string): string {
  const key = masterKey();
  const [ivHex, tagHex, encHex] = encoded.split(":");
  const iv  = Buffer.from(ivHex,  "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf-8");
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  /** Returns which providers have a key set for this user (not the keys themselves). */
  listProviders(userId: string): Provider[] {
    const rows = this.db
      .prepare(`SELECT provider FROM api_keys WHERE user_id = ?`)
      .all(userId) as { provider: Provider }[];
    return rows.map((r) => r.provider);
  }

  /** Retrieve decrypted API key for a provider, or null if not set. */
  getKey(userId: string, provider: Provider): string | null {
    const row = this.db
      .prepare(`SELECT key_enc FROM api_keys WHERE user_id = ? AND provider = ?`)
      .get(userId, provider) as { key_enc: string } | undefined;
    if (!row) return null;
    try {
      return decrypt(row.key_enc);
    } catch {
      return null;
    }
  }

  /** Save or update an API key. */
  setKey(userId: string, provider: Provider, apiKey: string): void {
    const id = randomUUID();
    const enc = encrypt(apiKey.trim());
    this.db
      .prepare(
        `INSERT INTO api_keys (id, user_id, provider, key_enc, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET key_enc = excluded.key_enc`,
      )
      .run(id, userId, provider, enc, Date.now());
  }

  deleteKey(userId: string, provider: Provider): void {
    this.db
      .prepare(`DELETE FROM api_keys WHERE user_id = ? AND provider = ?`)
      .run(userId, provider);
  }
}
