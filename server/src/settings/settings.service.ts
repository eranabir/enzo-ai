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
