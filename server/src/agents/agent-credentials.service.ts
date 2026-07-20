import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { VaultService } from "../vault/vault.service";
import type { AgentCredentialRow } from "../database/database.types";

export interface AgentCredentialPublic {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * Named secrets (API keys, tokens) scoped to a single agent — e.g. a trading
 * platform's API key for a stock-trading agent. Unlike the calendar/gmail
 * OAuth client secrets (settings.service.ts, stored plain), these hold
 * financial-grade credentials, so they always go through vault encryption —
 * never the plaintext fallback encryptField() uses when the vault isn't
 * configured. The vault must be set up before any credential can be added.
 *
 * Just a name + value — the tool that uses them (api_request in
 * tools.service.ts) lets the model place the value wherever a given API
 * needs it (header, query string, body), rather than this service assuming
 * any particular shape or restricting where it can be sent.
 *
 * Values are never returned to the API — list() only ever exposes the
 * name/createdAt. Only getForTool() decrypts, and it's called exclusively
 * from tool execution (tools.service.ts), never from a controller.
 */
@Injectable()
export class AgentCredentialsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseConnection,
    private readonly vault: VaultService,
  ) {}

  list(agentId: string, userId: string): AgentCredentialPublic[] {
    const rows = this.db
      .prepare(`SELECT id, name, created_at FROM agent_credentials WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(agentId, userId) as Pick<AgentCredentialRow, "id" | "name" | "created_at">[];
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  /** Names only — used to describe what's available to the model in the tool prompt. */
  listNames(agentId: string): string[] {
    const rows = this.db
      .prepare(`SELECT name FROM agent_credentials WHERE agent_id = ?`)
      .all(agentId) as { name: string }[];
    return rows.map((r) => r.name);
  }

  add(agentId: string, userId: string, name: string, value: string): AgentCredentialPublic {
    const trimmedName = name.trim();
    if (!trimmedName) throw new BadRequestException("A credential name is required.");
    if (!value.trim()) throw new BadRequestException("A credential value is required.");
    if (!this.vault.isConfigured()) {
      throw new BadRequestException(
        "Set up encryption (Settings → Vault) before adding agent credentials — they're too sensitive to store unencrypted.",
      );
    }
    // encryptField() throws VaultLockedError itself if configured-but-locked, which
    // surfaces as a 500; the isConfigured() check above only covers "never set up".
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO agent_credentials (id, agent_id, user_id, name, value_enc, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, agentId, userId, trimmedName, this.vault.encryptField(value), now);
    return { id, name: trimmedName, createdAt: now };
  }

  remove(id: string, agentId: string, userId: string): void {
    this.db
      .prepare(`DELETE FROM agent_credentials WHERE id = ? AND agent_id = ? AND user_id = ?`)
      .run(id, agentId, userId);
  }

  /** Internal use only (tool execution) — decrypts and returns the secret value.
   *  Never call this from a controller / anything that returns to the client. */
  getForTool(agentId: string, name: string): { value: string } | null {
    const row = this.db
      .prepare(`SELECT value_enc FROM agent_credentials WHERE agent_id = ? AND name = ?`)
      .get(agentId, name) as Pick<AgentCredentialRow, "value_enc"> | undefined;
    if (!row) return null;
    const value = this.vault.decryptField(row.value_enc);
    if (value === "🔒") return null; // vault locked — fail the tool call clearly rather than send a garbage token
    return { value };
  }
}
