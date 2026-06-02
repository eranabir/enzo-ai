import {
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { hashSecret, verifySecret } from "./password.util";
import type {
  CreateUserInput,
  ProfileSummary,
  PublicUser,
  UserRow,
} from "./users.types";

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  /** Public list for the login profile picker. */
  listProfiles(): ProfileSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, username, display_name, pin_hash FROM users ORDER BY created_at ASC`,
      )
      .all() as Pick<
      UserRow,
      "id" | "username" | "display_name" | "pin_hash"
    >[];
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      hasPin: !!r.pin_hash,
    }));
  }

  findById(id: string): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
      | UserRow
      | undefined;
  }

  findByUsername(username: string): UserRow | undefined {
    return this.db
      .prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`)
      .get(username) as UserRow | undefined;
  }

  create(input: CreateUserInput): UserRow {
    const username = input.username.trim();
    if (this.findByUsername(username)) {
      throw new ConflictException("That username is already taken");
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users
          (id, username, display_name, password_hash, pin_hash, about, assistant_style, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        username,
        input.displayName.trim() || username,
        hashSecret(input.password),
        input.pin ? hashSecret(input.pin) : null,
        input.about?.trim() || null,
        input.assistantStyle?.trim() || null,
        Date.now(),
      );
    return this.findById(id)!;
  }

  /** Verify a password or PIN against the stored hashes. */
  verifyCredential(
    user: UserRow,
    cred: { password?: string; pin?: string },
  ): boolean {
    if (cred.pin) return verifySecret(cred.pin, user.pin_hash);
    if (cred.password) return verifySecret(cred.password, user.password_hash);
    return false;
  }

  updateProfile(
    id: string,
    fields: { displayName?: string; about?: string; assistantStyle?: string },
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.displayName !== undefined) {
      sets.push("display_name = ?");
      vals.push(fields.displayName.trim());
    }
    if (fields.about !== undefined) {
      sets.push("about = ?");
      vals.push(fields.about.trim() || null);
    }
    if (fields.assistantStyle !== undefined) {
      sets.push("assistant_style = ?");
      vals.push(fields.assistantStyle.trim() || null);
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  toPublic(user: UserRow): PublicUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      about: user.about,
      assistantStyle: user.assistant_style,
      hasPin: !!user.pin_hash,
    };
  }
}
