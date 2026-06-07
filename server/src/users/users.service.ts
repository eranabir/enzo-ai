import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { hashSecret, verifySecret } from "./password.util";
import type {
  CreateUserInput,
  ProfileSummary,
  PublicUser,
  UserRole,
  UserRow,
} from "./users.types";

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  /** Public list for the login profile picker. */
  listProfiles(): ProfileSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, username, display_name, pin_hash, role FROM users ORDER BY created_at ASC`,
      )
      .all() as Pick<UserRow, "id" | "username" | "display_name" | "pin_hash" | "role">[];
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      hasPin: !!r.pin_hash,
      role: r.role,
    }));
  }

  /** All users — for admin panel. */
  listAll(): PublicUser[] {
    return (this.db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as UserRow[])
      .map((r) => this.toPublic(r));
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

  isEmpty(): boolean {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number };
    return row.c === 0;
  }

  create(input: CreateUserInput): UserRow {
    const username = input.username.trim();
    if (this.findByUsername(username)) {
      throw new ConflictException("That username is already taken");
    }
    const id = randomUUID();
    const role: UserRole = this.isEmpty() ? "admin" : "user";
    // Auto-build display name: nickname → first+last → username
    const fn = input.firstName?.trim() || "";
    const ln = input.lastName?.trim() || "";
    const nn = input.nickname?.trim() || "";
    const autoDisplay = nn || [fn, ln].filter(Boolean).join(" ") || username;
    const displayName = input.displayName?.trim() || autoDisplay;
    this.db
      .prepare(
        `INSERT INTO users
          (id, username, display_name, first_name, last_name, nickname, super_powers,
           password_hash, pin_hash, about, assistant_style, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        username,
        displayName,
        fn || null,
        ln || null,
        nn || null,
        input.superPowers?.trim() || null,
        hashSecret(input.password),
        input.pin ? hashSecret(input.pin) : null,
        input.about?.trim() || null,
        input.assistantStyle?.trim() || null,
        role,
        Date.now(),
      );
    return this.findById(id)!;
  }

  verifyCredential(user: UserRow, cred: { password?: string; pin?: string }): boolean {
    if (cred.pin) return verifySecret(cred.pin, user.pin_hash);
    if (cred.password) return verifySecret(cred.password, user.password_hash);
    return false;
  }

  updateProfile(
    id: string,
    fields: {
      displayName?: string;
      firstName?: string;
      lastName?: string;
      nickname?: string;
      superPowers?: string;
      about?: string;
      assistantStyle?: string;
    },
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const col = (key: string, val: string | undefined, nullable = true) => {
      if (val !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(val.trim() || (nullable ? null : val.trim()));
      }
    };
    col("display_name", fields.displayName, false);
    col("first_name", fields.firstName);
    col("last_name", fields.lastName);
    col("nickname", fields.nickname);
    col("super_powers", fields.superPowers);
    col("about", fields.about);
    col("assistant_style", fields.assistantStyle);
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  /** Admin: reset any user's password. */
  resetPassword(id: string, newPassword: string): void {
    if (!this.findById(id)) throw new NotFoundException("User not found");
    this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashSecret(newPassword), id);
  }

  /** Admin: delete a user and all their data. */
  deleteUser(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
    this.db.prepare(`DELETE FROM chats WHERE user_id = ?`).run(id);
    this.db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }

  toPublic(user: UserRow): PublicUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      firstName: user.first_name,
      lastName: user.last_name,
      nickname: user.nickname,
      superPowers: user.super_powers,
      about: user.about,
      assistantStyle: user.assistant_style,
      hasPin: !!user.pin_hash,
      role: user.role,
      isAdmin: user.role === "admin",
    };
  }
}
