import { Global, Module } from "@nestjs/common";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { config, dbPath } from "../config";

/** Injection token for the shared better-sqlite3 connection. */
export const DATABASE = Symbol("DATABASE");
export type DatabaseConnection = Database.Database;

/**
 * Provides a single SQLite connection app-wide and creates the schema on boot.
 * Users own chats; chats own messages. All of it is the locally-persisted
 * context/memory.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): DatabaseConnection => {
        fs.mkdirSync(config.dataDir, { recursive: true });
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");

        // ── Legacy rename migration (conversations → chats, integration → connection) ──
        // Runs BEFORE CREATE TABLE so existing installs are renamed in place rather
        // than getting an empty `chats` table alongside the old `conversations`.
        const tableExists = (name: string) =>
          !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
        const colExists = (table: string, col: string) =>
          tableExists(table) &&
          (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

        if (tableExists("conversations") && !tableExists("chats")) {
          db.exec(`ALTER TABLE conversations RENAME TO chats`);
        }
        if (tableExists("conversation_summaries") && !tableExists("chat_summaries")) {
          db.exec(`ALTER TABLE conversation_summaries RENAME TO chat_summaries`);
        }
        if (colExists("chats", "integration") && !colExists("chats", "connection")) {
          db.exec(`ALTER TABLE chats RENAME COLUMN integration TO connection`);
        }
        if (colExists("messages", "conversation_id") && !colExists("messages", "chat_id")) {
          db.exec(`ALTER TABLE messages RENAME COLUMN conversation_id TO chat_id`);
        }
        if (colExists("memories", "source_conversation_id") && !colExists("memories", "source_chat_id")) {
          db.exec(`ALTER TABLE memories RENAME COLUMN source_conversation_id TO source_chat_id`);
        }
        if (colExists("chat_summaries", "conversation_id") && !colExists("chat_summaries", "chat_id")) {
          db.exec(`ALTER TABLE chat_summaries RENAME COLUMN conversation_id TO chat_id`);
        }

        db.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id               TEXT PRIMARY KEY,
            username         TEXT NOT NULL UNIQUE,
            display_name     TEXT NOT NULL,
            first_name       TEXT,
            last_name        TEXT,
            nickname         TEXT,
            super_powers     TEXT,
            password_hash    TEXT NOT NULL,
            pin_hash         TEXT,
            about            TEXT,
            assistant_style  TEXT,
            role             TEXT NOT NULL DEFAULT 'user',
            created_at       INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS settings (
            key    TEXT PRIMARY KEY,
            value  TEXT
          );

          CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at  INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS api_keys (
            id           TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider     TEXT NOT NULL CHECK (provider IN ('openai','anthropic','google')),
            key_enc      TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            UNIQUE(user_id, provider)
          );

          CREATE TABLE IF NOT EXISTS chats (
            id             TEXT PRIMARY KEY,
            user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
            title          TEXT NOT NULL DEFAULT 'New chat',
            model          TEXT,
            memory_enabled INTEGER NOT NULL DEFAULT 1,
            agent_id       TEXT,
            connection     TEXT,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS messages (
            id         TEXT PRIMARY KEY,
            chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            role       TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
            content    TEXT NOT NULL,
            image_mime TEXT,
            attachment_name TEXT,
            attachment_mime TEXT,
            attachment_text TEXT,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS memories (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type            TEXT NOT NULL CHECK (type IN ('fact','decision','preference','work_context')),
            content         TEXT NOT NULL,
            source_chat_id  TEXT REFERENCES chats(id) ON DELETE SET NULL,
            created_at      INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS chat_summaries (
            chat_id     TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
            summary     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS agents (
            id               TEXT PRIMARY KEY,
            user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name             TEXT NOT NULL,
            emoji            TEXT NOT NULL DEFAULT '🤖',
            description      TEXT,
            instructions     TEXT NOT NULL,
            model            TEXT,
            tools            TEXT NOT NULL DEFAULT '[]',
            schedule         TEXT,
            schedule_prompt  TEXT,
            schedule_enabled INTEGER NOT NULL DEFAULT 0,
            last_run_at      INTEGER,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS mcp_servers (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            type       TEXT NOT NULL DEFAULT 'stdio',
            command    TEXT,
            args       TEXT NOT NULL DEFAULT '[]',
            env        TEXT NOT NULL DEFAULT '{}',
            url        TEXT,
            enabled    INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS knowledge_bases (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            description     TEXT,
            embedding_model TEXT NOT NULL,
            created_at      INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS knowledge_documents (
            id          TEXT PRIMARY KEY,
            kb_id       TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'text',
            source_ref  TEXT,
            status      TEXT NOT NULL DEFAULT 'ready',
            error       TEXT,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS knowledge_chunks (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
            kb_id       TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
            user_id     TEXT NOT NULL,
            idx         INTEGER NOT NULL,
            content     TEXT NOT NULL,
            embedding   BLOB NOT NULL,
            created_at  INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_messages_chat
            ON messages(chat_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_agents_user
            ON agents(user_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_memories_user
            ON memories(user_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_mcp_servers_user
            ON mcp_servers(user_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user
            ON knowledge_bases(user_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb
            ON knowledge_documents(kb_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kb
            ON knowledge_chunks(kb_id);
        `);

        // ── Column-add migrations (older installs) — guarded so they're no-ops on fresh DBs ──
        if (!colExists("chats", "user_id"))        db.exec(`ALTER TABLE chats ADD COLUMN user_id TEXT`);
        if (!colExists("chats", "memory_enabled"))  db.exec(`ALTER TABLE chats ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1`);
        if (!colExists("chats", "agent_id"))        db.exec(`ALTER TABLE chats ADD COLUMN agent_id TEXT`);
        if (!colExists("chats", "connection"))      db.exec(`ALTER TABLE chats ADD COLUMN connection TEXT`);
        if (!colExists("chats", "knowledge_base_id")) db.exec(`ALTER TABLE chats ADD COLUMN knowledge_base_id TEXT`);
        if (!colExists("agents", "knowledge_base_id")) db.exec(`ALTER TABLE agents ADD COLUMN knowledge_base_id TEXT`);

        const agentCols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
        if (!agentCols.some((c) => c.name === "telegram_chat_ids")) {
          db.exec(`ALTER TABLE agents ADD COLUMN telegram_chat_ids TEXT`);
        }

        // Clean up old emoji prefixes from connection chat titles (💬 / 🎮)
        db.prepare(
          `UPDATE chats SET title = TRIM(REPLACE(REPLACE(title, '💬 ', ''), '🎮 ', ''))
           WHERE connection IS NOT NULL AND (title LIKE '💬 %' OR title LIKE '🎮 %')`
        ).run();

        if (!colExists("messages", "image_mime")) db.exec(`ALTER TABLE messages ADD COLUMN image_mime TEXT`);
        if (!colExists("messages", "attachment_name")) db.exec(`ALTER TABLE messages ADD COLUMN attachment_name TEXT`);
        if (!colExists("messages", "attachment_mime")) db.exec(`ALTER TABLE messages ADD COLUMN attachment_mime TEXT`);
        if (!colExists("messages", "attachment_text")) db.exec(`ALTER TABLE messages ADD COLUMN attachment_text TEXT`);

        const userCols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
        if (!userCols.some((c) => c.name === "role")) {
          db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
        }
        for (const col of ["first_name", "last_name", "nickname", "super_powers"] as const) {
          if (!userCols.some((c) => c.name === col)) {
            db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
          }
        }

        // Promote the oldest user to admin if no admin exists yet.
        const hasAdmin = db.prepare(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`).get();
        if (!hasAdmin) {
          db.prepare(`UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)`).run();
        }

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_chats_user
            ON chats(user_id, updated_at);
        `);

        return db;
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
