import { Global, Module } from "@nestjs/common";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { config, dbPath } from "../config";

/** Injection token for the shared better-sqlite3 connection. */
export const DATABASE = Symbol("DATABASE");
export type DatabaseConnection = Database.Database;

/**
 * Provides a single SQLite connection app-wide and creates the schema on boot.
 * Users own conversations; conversations own messages. All of it is the
 * locally-persisted context/memory.
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

          CREATE TABLE IF NOT EXISTS conversations (
            id          TEXT PRIMARY KEY,
            user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
            title       TEXT NOT NULL DEFAULT 'New chat',
            model       TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role            TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
            content         TEXT NOT NULL,
            created_at      INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS memories (
            id                     TEXT PRIMARY KEY,
            user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type                   TEXT NOT NULL CHECK (type IN ('fact','decision','preference','work_context')),
            content                TEXT NOT NULL,
            source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
            created_at             INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS conversation_summaries (
            conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
            summary          TEXT NOT NULL,
            created_at       INTEGER NOT NULL
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

          CREATE INDEX IF NOT EXISTS idx_messages_conversation
            ON messages(conversation_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_agents_user
            ON agents(user_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_memories_user
            ON memories(user_id, created_at);
        `);

        // Migrations — run before any indexes that reference the new columns.
        const convCols = db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[];
        if (!convCols.some((c) => c.name === "user_id")) {
          db.exec(`ALTER TABLE conversations ADD COLUMN user_id TEXT`);
        }
        if (!convCols.some((c) => c.name === "memory_enabled")) {
          db.exec(`ALTER TABLE conversations ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1`);
        }
        if (!convCols.some((c) => c.name === "agent_id")) {
          db.exec(`ALTER TABLE conversations ADD COLUMN agent_id TEXT`);
        }

        // Add image_mime to messages for vision / image-upload support
        const msgCols = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
        if (!msgCols.some((c) => c.name === "image_mime")) {
          db.exec(`ALTER TABLE messages ADD COLUMN image_mime TEXT`);
        }

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
          CREATE INDEX IF NOT EXISTS idx_conversations_user
            ON conversations(user_id, updated_at);
        `);

        return db;
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
