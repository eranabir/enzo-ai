import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import type {
  ConversationRow,
  MessageRow,
  Role,
} from "../database/database.types";

const now = () => Date.now();

/** Reads/writes conversations + messages — Enzo's AI local memory. */
@Injectable()
export class ConversationsService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  /** A user's conversations, most recent first. */
  list(userId: string): ConversationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(userId) as ConversationRow[];
  }

  /** Fetch a conversation only if it belongs to the given user. */
  get(id: string, userId: string): ConversationRow | undefined {
    return this.db
      .prepare(`SELECT * FROM conversations WHERE id = ? AND user_id = ?`)
      .get(id, userId) as ConversationRow | undefined;
  }

  create(userId: string, model?: string, agentId?: string): ConversationRow {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO conversations (id, user_id, title, model, agent_id, created_at, updated_at)
         VALUES (?, ?, 'New chat', ?, ?, ?, ?)`,
      )
      .run(id, userId, model ?? null, agentId ?? null, t, t);
    return this.get(id, userId)!;
  }

  rename(id: string, title: string): void {
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, now(), id);
  }

  setModel(id: string, model: string): void {
    this.db
      .prepare(`UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?`)
      .run(model, now(), id);
  }

  setMemoryEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(`UPDATE conversations SET memory_enabled = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, id);
  }

  delete(id: string): void {
    // messages are removed via ON DELETE CASCADE (foreign_keys pragma on)
    this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id);
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  }

  listMessages(conversationId: string): MessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(conversationId) as MessageRow[];
  }

  addMessage(conversationId: string, role: Role, content: string, imageMime?: string): MessageRow {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, image_mime, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, conversationId, role, content, imageMime ?? null, t);
    this.db
      .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
      .run(t, conversationId);
    return { id, conversation_id: conversationId, role, content, image_mime: imageMime ?? null, created_at: t } as MessageRow;
  }

  /** Look up which conversation a message belongs to (for auth checks). */
  getMessageConversation(messageId: string): { conversation_id: string } | undefined {
    return this.db
      .prepare(`SELECT conversation_id FROM messages WHERE id = ?`)
      .get(messageId) as { conversation_id: string } | undefined;
  }
}
