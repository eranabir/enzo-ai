import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import type { ToolName } from "./tools.service";

export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  description: string | null;
  instructions: string;
  model: string | null;
  tools: string; // JSON array
  schedule: string | null;
  schedule_prompt: string | null;
  schedule_enabled: number;
  telegram_chat_ids: string | null; // comma-separated Telegram chat IDs
  knowledge_base_id: string | null;
  skill_ids: string | null; // JSON array of skill ids
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateAgentInput {
  name: string;
  emoji?: string;
  description?: string;
  instructions: string;
  model?: string;
  tools?: ToolName[];
  schedule?: string;
  schedulePrompt?: string;
  scheduleEnabled?: boolean;
  telegramChatIds?: string; // comma-separated
  knowledgeBaseId?: string | null;
  skillIds?: string[];
}

@Injectable()
export class AgentsService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  list(userId: string): AgentRow[] {
    return this.db
      .prepare(`SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as AgentRow[];
  }

  get(id: string, userId: string): AgentRow | undefined {
    return this.db
      .prepare(`SELECT * FROM agents WHERE id = ? AND user_id = ?`)
      .get(id, userId) as AgentRow | undefined;
  }

  /** Get all scheduled agents across all users (for the cron runner). */
  getAllScheduled(): (AgentRow & { username: string })[] {
    return this.db
      .prepare(
        `SELECT a.*, u.username FROM agents a
         JOIN users u ON u.id = a.user_id
         WHERE a.schedule IS NOT NULL AND a.schedule_enabled = 1`,
      )
      .all() as (AgentRow & { username: string })[];
  }

  create(userId: string, input: CreateAgentInput): AgentRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO agents
          (id, user_id, name, emoji, description, instructions, model, tools,
           schedule, schedule_prompt, schedule_enabled, telegram_chat_ids, knowledge_base_id, skill_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, userId,
        input.name.trim(),
        input.emoji ?? "🤖",
        input.description?.trim() ?? null,
        input.instructions.trim(),
        input.model ?? null,
        JSON.stringify(input.tools ?? []),
        input.schedule ?? null,
        input.schedulePrompt ?? null,
        input.scheduleEnabled ? 1 : 0,
        input.telegramChatIds?.trim() || null,
        input.knowledgeBaseId || null,
        JSON.stringify(input.skillIds ?? []),
        now, now,
      );
    return this.get(id, userId)!;
  }

  update(id: string, userId: string, input: Partial<CreateAgentInput>): AgentRow | undefined {
    const existing = this.get(id, userId);
    if (!existing) return undefined;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const col = (k: string, v: unknown) => { sets.push(`${k} = ?`); vals.push(v); };
    if (input.name !== undefined)          col("name", input.name.trim());
    if (input.emoji !== undefined)         col("emoji", input.emoji);
    if (input.description !== undefined)   col("description", input.description?.trim() ?? null);
    if (input.instructions !== undefined)  col("instructions", input.instructions.trim());
    if (input.model !== undefined)         col("model", input.model ?? null);
    if (input.tools !== undefined)         col("tools", JSON.stringify(input.tools));
    if (input.schedule !== undefined)      col("schedule", input.schedule ?? null);
    if (input.schedulePrompt !== undefined) col("schedule_prompt", input.schedulePrompt ?? null);
    if (input.scheduleEnabled !== undefined) col("schedule_enabled", input.scheduleEnabled ? 1 : 0);
    if (input.telegramChatIds !== undefined) col("telegram_chat_ids", input.telegramChatIds?.trim() || null);
    if (input.knowledgeBaseId !== undefined) col("knowledge_base_id", input.knowledgeBaseId || null);
    if (input.skillIds !== undefined)      col("skill_ids", JSON.stringify(input.skillIds));
    if (!sets.length) return existing;
    col("updated_at", Date.now());
    vals.push(id, userId);
    this.db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals);
    return this.get(id, userId);
  }

  delete(id: string, userId: string): void {
    this.db.prepare(`DELETE FROM agents WHERE id = ? AND user_id = ?`).run(id, userId);
  }

  /** Parse the skill_ids JSON column defensively (older rows have NULL). */
  parseSkillIds(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  markLastRun(id: string): void {
    this.db.prepare(`UPDATE agents SET last_run_at = ? WHERE id = ?`).run(Date.now(), id);
  }

  toPublic(a: AgentRow) {
    return {
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      description: a.description,
      instructions: a.instructions,
      model: a.model,
      tools: JSON.parse(a.tools) as ToolName[],
      schedule: a.schedule,
      schedulePrompt: a.schedule_prompt,
      scheduleEnabled: !!a.schedule_enabled,
      telegramChatIds: a.telegram_chat_ids ?? "",
      knowledgeBaseId: a.knowledge_base_id ?? null,
      skillIds: this.parseSkillIds(a.skill_ids),
      lastRunAt: a.last_run_at,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    };
  }
}
