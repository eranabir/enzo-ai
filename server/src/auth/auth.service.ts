import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";

/**
 * Opaque session tokens stored locally in SQLite. Good enough for separating
 * local profiles; this is not a hardened remote-auth system.
 */
@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  createSession(userId: string): string {
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare(
        `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .run(token, userId, Date.now());
    return token;
  }

  resolveUserId(token: string | undefined): string | undefined {
    if (!token) return undefined;
    const row = this.db
      .prepare(`SELECT user_id FROM sessions WHERE token = ?`)
      .get(token) as { user_id: string } | undefined;
    return row?.user_id;
  }

  destroySession(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }
}
