import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { VaultService } from "../vault/vault.service";
import type { MemoryRow, ChatSummaryRow, MemoryType } from "../database/database.types";

@Injectable()
export class MemoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseConnection,
    private readonly vault: VaultService,
  ) {}

  // ── Memories ──────────────────────────────────────────────────────────────

  list(userId: string): MemoryRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as MemoryRow[];
    for (const r of rows) r.content = this.vault.decryptField(r.content);
    return rows;
  }

  /** Most recent N memories — used for system prompt injection. */
  recent(userId: string, limit = 8): MemoryRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, limit) as MemoryRow[];
    for (const r of rows) r.content = this.vault.decryptField(r.content);
    return rows;
  }

  add(
    userId: string,
    type: MemoryType,
    content: string,
    sourceChatId?: string,
  ): MemoryRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO memories (id, user_id, type, content, source_chat_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, type, this.vault.encryptField(content.trim()), sourceChatId ?? null, now);
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as MemoryRow;
    row.content = this.vault.decryptField(row.content);
    return row;
  }

  delete(userId: string, id: string): void {
    this.db
      .prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`)
      .run(id, userId);
  }

  clearAll(userId: string): void {
    this.db.prepare(`DELETE FROM memories WHERE user_id = ?`).run(userId);
  }

  // ── Chat summaries ────────────────────────────────────────────────

  getSummary(chatId: string): ChatSummaryRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM chat_summaries WHERE chat_id = ?`)
      .get(chatId) as ChatSummaryRow | undefined;
    if (row) row.summary = this.vault.decryptField(row.summary);
    return row;
  }

  hasSummary(chatId: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM chat_summaries WHERE chat_id = ?`)
      .get(chatId);
  }

  saveSummary(chatId: string, summary: string): void {
    this.db
      .prepare(
        `INSERT INTO chat_summaries (chat_id, summary, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET summary = excluded.summary`,
      )
      .run(chatId, this.vault.encryptField(summary.trim()), Date.now());
  }

  /**
   * Recent summaries for other chats by this user — injected as
   * "what you were working on recently" context.
   */
  recentSummaries(
    userId: string,
    excludeChatId: string,
    limit = 3,
  ): ChatSummaryRow[] {
    const rows = this.db
      .prepare(
        `SELECT cs.*
         FROM chat_summaries cs
         JOIN chats c ON c.id = cs.chat_id
         WHERE c.user_id = ?
           AND cs.chat_id != ?
         ORDER BY cs.created_at DESC
         LIMIT ?`,
      )
      .all(userId, excludeChatId, limit) as ChatSummaryRow[];
    for (const r of rows) r.summary = this.vault.decryptField(r.summary);
    return rows;
  }
}
