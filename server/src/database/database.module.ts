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

          CREATE INDEX IF NOT EXISTS idx_messages_conversation
            ON messages(conversation_id, created_at);
        `);

        // Migration: add user_id to conversations created before multi-user.
        // Must run before any index that references the column, because for a
        // pre-existing table `CREATE TABLE IF NOT EXISTS` above is a no-op.
        const cols = db
          .prepare(`PRAGMA table_info(conversations)`)
          .all() as { name: string }[];
        if (!cols.some((c) => c.name === "user_id")) {
          db.exec(`ALTER TABLE conversations ADD COLUMN user_id TEXT`);
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
