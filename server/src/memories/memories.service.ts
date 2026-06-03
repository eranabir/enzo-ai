import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import type { MemoryRow, ConversationSummaryRow, MemoryType } from "../database/database.types";

@Injectable()
export class MemoriesService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  // ── Memories ──────────────────────────────────────────────────────────────

  list(userId: string): MemoryRow[] {
    return this.db
      .prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as MemoryRow[];
  }

  /** Most recent N memories — used for system prompt injection. */
  recent(userId: string, limit = 8): MemoryRow[] {
    return this.db
      .prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, limit) as MemoryRow[];
  }

  add(
    userId: string,
    type: MemoryType,
    content: string,
    sourceConversationId?: string,
  ): MemoryRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO memories (id, user_id, type, content, source_conversation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, type, content.trim(), sourceConversationId ?? null, now);
    return this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as MemoryRow;
  }

  delete(userId: string, id: string): void {
    this.db
      .prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`)
      .run(id, userId);
  }

  clearAll(userId: string): void {
    this.db.prepare(`DELETE FROM memories WHERE user_id = ?`).run(userId);
  }

  // ── Conversation summaries ────────────────────────────────────────────────

  getSummary(conversationId: string): ConversationSummaryRow | undefined {
    return this.db
      .prepare(`SELECT * FROM conversation_summaries WHERE conversation_id = ?`)
      .get(conversationId) as ConversationSummaryRow | undefined;
  }

  hasSummary(conversationId: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM conversation_summaries WHERE conversation_id = ?`)
      .get(conversationId);
  }

  saveSummary(conversationId: string, summary: string): void {
    this.db
      .prepare(
        `INSERT INTO conversation_summaries (conversation_id, summary, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary`,
      )
      .run(conversationId, summary.trim(), Date.now());
  }

  /**
   * Recent summaries for other conversations by this user — injected as
   * "what you were working on recently" context.
   */
  recentSummaries(
    userId: string,
    excludeConversationId: string,
    limit = 3,
  ): ConversationSummaryRow[] {
    return this.db
      .prepare(
        `SELECT cs.*
         FROM conversation_summaries cs
         JOIN conversations c ON c.id = cs.conversation_id
         WHERE c.user_id = ?
           AND cs.conversation_id != ?
         ORDER BY cs.created_at DESC
         LIMIT ?`,
      )
      .all(userId, excludeConversationId, limit) as ConversationSummaryRow[];
  }
}
