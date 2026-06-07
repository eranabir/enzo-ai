import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { VaultService } from "../vault/vault.service";
import type {
  ChatRow,
  MessageRow,
  Role,
} from "../database/database.types";

const now = () => Date.now();

/** Reads/writes chats + messages — Enzo's AI local memory. */
@Injectable()
export class ChatsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseConnection,
    private readonly vault: VaultService,
  ) {}

  /** Decrypt a chat row's title in place (no-op when unencrypted). */
  private decryptConvo(row: ChatRow | undefined): ChatRow | undefined {
    if (row) row.title = this.vault.decryptField(row.title);
    return row;
  }

  /** A user's chats, most recent first. */
  list(userId: string): ChatRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(userId) as ChatRow[];
    return rows.map((r) => this.decryptConvo(r)!);
  }

  /** Fetch a chat only if it belongs to the given user. */
  get(id: string, userId: string): ChatRow | undefined {
    return this.decryptConvo(
      this.db
        .prepare(`SELECT * FROM chats WHERE id = ? AND user_id = ?`)
        .get(id, userId) as ChatRow | undefined,
    );
  }

  create(userId: string, model?: string, agentId?: string, connection?: string): ChatRow {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO chats (id, user_id, title, model, agent_id, connection, created_at, updated_at)
         VALUES (?, ?, 'New chat', ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, model ?? null, agentId ?? null, connection ?? null, t, t);
    return this.get(id, userId)!;
  }

  /** Find a chat by connection type for a user. */
  getByConnection(userId: string, connection: string): ChatRow | undefined {
    return this.decryptConvo(
      this.db
        .prepare(`SELECT * FROM chats WHERE user_id = ? AND connection = ? LIMIT 1`)
        .get(userId, connection) as ChatRow | undefined,
    );
  }

  rename(id: string, title: string): void {
    this.db
      .prepare(`UPDATE chats SET title = ?, updated_at = ? WHERE id = ?`)
      .run(this.vault.encryptField(title), now(), id);
  }

  setAgent(id: string, agentId: string | null): void {
    this.db
      .prepare(`UPDATE chats SET agent_id = ?, updated_at = ? WHERE id = ?`)
      .run(agentId, now(), id);
  }

  setModel(id: string, model: string): void {
    this.db
      .prepare(`UPDATE chats SET model = ?, updated_at = ? WHERE id = ?`)
      .run(model, now(), id);
  }

  setMemoryEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(`UPDATE chats SET memory_enabled = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, id);
  }

  delete(id: string): void {
    // messages are removed via ON DELETE CASCADE (foreign_keys pragma on)
    this.db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(id);
    this.db.prepare(`DELETE FROM chats WHERE id = ?`).run(id);
  }

  /** Delete every chat (and its messages) for a user tied to an connection. */
  deleteByConnection(userId: string, connection: string): number {
    const rows = this.db
      .prepare(`SELECT id FROM chats WHERE user_id = ? AND connection = ?`)
      .all(userId, connection) as { id: string }[];
    for (const { id } of rows) this.delete(id);
    return rows.length;
  }

  listMessages(chatId: string): MessageRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC`,
      )
      .all(chatId) as MessageRow[];
    for (const r of rows) r.content = this.vault.decryptField(r.content);
    return rows;
  }

  addMessage(chatId: string, role: Role, content: string, imageMime?: string): MessageRow {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO messages (id, chat_id, role, content, image_mime, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, chatId, role, this.vault.encryptField(content), imageMime ?? null, t);
    this.db
      .prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`)
      .run(t, chatId);
    return { id, chat_id: chatId, role, content, image_mime: imageMime ?? null, created_at: t } as MessageRow;
  }

  /**
   * Delete a message and every message after it in the same chat (used to
   * regenerate or edit-and-resend). Returns the number of rows removed.
   */
  deleteMessageAndAfter(chatId: string, messageId: string): number {
    const row = this.db
      .prepare(`SELECT created_at FROM messages WHERE id = ? AND chat_id = ?`)
      .get(messageId, chatId) as { created_at: number } | undefined;
    if (!row) return 0;
    const res = this.db
      .prepare(`DELETE FROM messages WHERE chat_id = ? AND created_at >= ?`)
      .run(chatId, row.created_at);
    return res.changes;
  }

  /** Look up which chat a message belongs to (for auth checks). */
  getMessageChat(messageId: string): { chat_id: string } | undefined {
    return this.db
      .prepare(`SELECT chat_id FROM messages WHERE id = ?`)
      .get(messageId) as { chat_id: string } | undefined;
  }
}
