import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";

export interface SkillRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  instructions: string;
  created_at: number;
  updated_at: number;
}

export interface SkillInput {
  name: string;
  description?: string;
  instructions: string;
}

/**
 * A skill is reusable, on-demand know-how: a name + a short description the model
 * sees up front, and a full instructions body it loads only when a task matches
 * (via the load_skill tool). Skills are per-user and attached to agents; the same
 * skill can be reused across many agents instead of re-pasting instructions.
 */
@Injectable()
export class SkillsService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  list(userId: string): SkillRow[] {
    return this.db
      .prepare(`SELECT * FROM skills WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as SkillRow[];
  }

  get(id: string, userId: string): SkillRow | undefined {
    return this.db
      .prepare(`SELECT * FROM skills WHERE id = ? AND user_id = ?`)
      .get(id, userId) as SkillRow | undefined;
  }

  /** Resolve a set of skill ids to rows, preserving the given order and
   *  silently dropping ids that no longer exist (a deleted skill). */
  getByIds(ids: string[], userId: string): SkillRow[] {
    if (!ids.length) return [];
    const rows = this.db
      .prepare(`SELECT * FROM skills WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
      .all(userId, ...ids) as SkillRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is SkillRow => !!r);
  }

  create(userId: string, input: SkillInput): SkillRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO skills (id, user_id, name, description, instructions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, userId,
        input.name.trim(),
        input.description?.trim() ?? "",
        input.instructions.trim(),
        now, now,
      );
    return this.get(id, userId)!;
  }

  update(id: string, userId: string, input: Partial<SkillInput>): SkillRow | undefined {
    const existing = this.get(id, userId);
    if (!existing) return undefined;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const col = (k: string, v: unknown) => { sets.push(`${k} = ?`); vals.push(v); };
    if (input.name !== undefined)         col("name", input.name.trim());
    if (input.description !== undefined)  col("description", input.description?.trim() ?? "");
    if (input.instructions !== undefined) col("instructions", input.instructions.trim());
    if (!sets.length) return existing;
    col("updated_at", Date.now());
    vals.push(id, userId);
    this.db.prepare(`UPDATE skills SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals);
    return this.get(id, userId);
  }

  delete(id: string, userId: string): void {
    this.db.prepare(`DELETE FROM skills WHERE id = ? AND user_id = ?`).run(id, userId);
  }

  toPublic(s: SkillRow) {
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  }
}
