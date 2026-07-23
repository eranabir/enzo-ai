import { Inject, Injectable } from "@nestjs/common";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { config } from "../config";

@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  get(key: string): string | null {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  getDefaultModel(): string {
    return this.get("default_model") ?? config.defaultModel;
  }

  setDefaultModel(model: string): void {
    this.set("default_model", model);
  }

  getDisabledTools(): string[] {
    const raw = this.get("disabled_tools");
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }

  setDisabledTools(tools: string[]): void {
    this.set("disabled_tools", JSON.stringify(tools));
  }

  isToolEnabled(name: string): boolean {
    return !this.getDisabledTools().includes(name);
  }

  /** Whether agent-less ("regular") chats may use tools. Default OFF — keeps
   *  plain chats fast (true streaming, no tool-detection round). */
  getChatToolsEnabled(): boolean {
    return this.get("chat_tools_enabled") === "1";
  }

  setChatToolsEnabled(enabled: boolean): void {
    this.set("chat_tools_enabled", enabled ? "1" : "0");
  }

  /** Context window (num_ctx) for local Ollama requests. Capped by default at
   *  8192: left at the model's own max, a big model can be forced to split
   *  between GPU and much slower CPU inference. Larger values need the VRAM
   *  to back them. */
  getNumCtx(): number {
    const n = parseInt(this.get("num_ctx") ?? "", 10);
    return Number.isFinite(n) && n >= 2048 ? n : 8192;
  }

  setNumCtx(n: number): void {
    this.set("num_ctx", String(n));
  }

  // ── Connections (admin can globally enable/disable a connection type) ────────
  getDisabledConnections(): string[] {
    const raw = this.get("disabled_connections");
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }

  setDisabledConnections(ids: string[]): void {
    this.set("disabled_connections", JSON.stringify(ids));
  }

  isConnectionEnabled(id: string): boolean {
    return !this.getDisabledConnections().includes(id);
  }

  all(): Record<string, string> {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
