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

  // ── CLI browser sign-in ─────────────────────────────────────────────────────
  // Device-code-style flow: the CLI mints a one-time code, opens the web UI
  // with it, and polls until a signed-in user approves it there. In-memory
  // only — a pending request doesn't survive a server restart, which is fine
  // (the CLI just starts over).

  private static readonly CLI_AUTH_TTL_MS = 5 * 60_000;
  private readonly cliAuthRequests = new Map<string, { createdAt: number; token?: string }>();

  private pruneCliAuth(): void {
    const now = Date.now();
    for (const [code, entry] of this.cliAuthRequests) {
      if (now - entry.createdAt > AuthService.CLI_AUTH_TTL_MS) this.cliAuthRequests.delete(code);
    }
  }

  cliAuthStart(): { code: string; expiresInSeconds: number } {
    this.pruneCliAuth();
    const code = randomBytes(32).toString("hex");
    this.cliAuthRequests.set(code, { createdAt: Date.now() });
    return { code, expiresInSeconds: AuthService.CLI_AUTH_TTL_MS / 1000 };
  }

  /** Called from the web UI by a signed-in user to authorize the waiting CLI. */
  cliAuthApprove(code: string, userId: string): boolean {
    this.pruneCliAuth();
    const entry = this.cliAuthRequests.get(code);
    if (!entry || entry.token) return false;
    entry.token = this.createSession(userId);
    return true;
  }

  /** Polled by the CLI. The token is handed out exactly once. */
  cliAuthPoll(code: string): { status: "pending" | "approved" | "unknown"; token?: string } {
    this.pruneCliAuth();
    const entry = this.cliAuthRequests.get(code);
    if (!entry) return { status: "unknown" };
    if (!entry.token) return { status: "pending" };
    this.cliAuthRequests.delete(code);
    return { status: "approved", token: entry.token };
  }
}
