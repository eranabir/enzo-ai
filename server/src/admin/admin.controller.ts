import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AdminGuard } from "../auth/admin.guard";
import { UserId } from "../auth/current-user.decorator";
import { DATABASE } from "../database/database.module";
import type { DatabaseConnection } from "../database/database.module";
import { ApiKeysService } from "../api-keys/api-keys.service";
import { UsersService } from "../users/users.service";
import { SettingsService } from "../settings/settings.service";
import { LlmService } from "../llm/llm.service";
import { ToolsService } from "../agents/tools.service";
import { TelegramService } from "../telegram/telegram.service";
import { DiscordService } from "../discord/discord.service";
import { SlackService } from "../slack/slack.service";
import { CalendarService } from "../calendar/calendar.service";

/** Connection types the admin can globally enable/disable. */
const CONNECTIONS = [
  { id: "telegram", name: "Telegram" },
  { id: "discord",  name: "Discord" },
  { id: "slack",    name: "Slack" },
  { id: "google",   name: "Google Calendar" },
  { id: "gmail",    name: "Gmail" },
];

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly apiKeys: ApiKeysService,
    private readonly toolsSvc: ToolsService,
    private readonly telegram: TelegramService,
    private readonly discord: DiscordService,
    private readonly slack: SlackService,
    private readonly calendarSvc: CalendarService,
    @Inject(DATABASE) private readonly db: DatabaseConnection,
  ) {}

  // ---- User management ----

  @Get("users")
  listUsers() {
    return this.users.listAll();
  }

  @Put("users/:id/password")
  resetPassword(
    @Param("id") id: string,
    @Body() body: { password?: string },
  ) {
    const pw = String(body?.password ?? "").trim();
    if (pw.length < 4) throw new BadRequestException("Password must be at least 4 characters");
    this.users.resetPassword(id, pw);
    return { ok: true };
  }

  @Delete("users/:id")
  deleteUser(@Param("id") id: string) {
    this.users.deleteUser(id);
    return { ok: true };
  }

  // ---- Model management ----

  @Get("models")
  async listModels(@UserId() userId: string) {
    const [models, status, configuredProviders] = await Promise.all([
      this.llm.listAllModels(userId),
      this.llm.ollama.isAvailable(),
      Promise.resolve(this.apiKeys.listProviders(userId)),
    ]);
    return {
      models,
      ollamaOnline: status,
      defaultModel: this.settings.getDefaultModel(),
      configuredProviders,
    };
  }

  @Put("models/default")
  setDefault(@Body() body: { model?: string }) {
    const model = String(body?.model ?? "").trim();
    if (!model) throw new BadRequestException("model is required");
    this.settings.setDefaultModel(model);
    return { defaultModel: model };
  }

  /** Pull a new model with live progress streamed over SSE. */
  @Post("models/pull")
  async pullModel(
    @Body() body: { model?: string },
    @Res() res: Response,
  ) {
    const model = String(body?.model ?? "").trim();
    if (!model) throw new BadRequestException("model is required");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      for await (const ev of this.llm.ollama.pullModel(model)) {
        // ev = { status, completed?, total? } — forwarded so the UI can show a bar
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
    } finally {
      res.end();
    }
  }

  /** Delete a local model from Ollama. */
  @Delete("models/:name")
  async deleteModel(@Param("name") name: string) {
    const res = await fetch(`${this.llm.ollama["baseUrl"]}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name }),
    });
    if (!res.ok) throw new BadRequestException(`Ollama delete failed: ${res.status}`);
    return { ok: true };
  }

  // ---- Settings ----

  @Get("settings")
  getSettings() {
    return { defaultModel: this.settings.getDefaultModel() };
  }

  // ---- Tool management ----

  @Get("tools")
  listTools(@UserId() userId: string) {
    return this.toolsSvc.getAllWithStatus(userId);
  }

  @Patch("tools/:name")
  toggleTool(@UserId() userId: string, @Param("name") name: string, @Body() body: { enabled: boolean }) {
    const all = this.toolsSvc.getAllWithStatus(userId);
    if (!all.find((t) => t.name === name)) throw new NotFoundException(`Tool "${name}" not found`);
    const disabled = this.settings.getDisabledTools();
    if (body.enabled) {
      this.settings.setDisabledTools(disabled.filter((t) => t !== name));
    } else {
      if (!disabled.includes(name)) this.settings.setDisabledTools([...disabled, name]);
    }
    return this.toolsSvc.getAllWithStatus(userId);
  }

  // Telegram is now a per-user integration — see TelegramController
  // (GET/PUT/DELETE /api/integrations/telegram). Each user connects their own bot.

  // Telegram / Discord / Slack are now per-user integrations — see their
  // controllers (/api/integrations/{telegram,discord,slack}). The admin controls
  // global availability via the connections endpoints below.

  // ── Connections (global enable/disable) ─────────────────────────────────────

  @Get("connections")
  getConnections() {
    return CONNECTIONS.map((c) => ({ ...c, enabled: this.settings.isConnectionEnabled(c.id) }));
  }

  @Patch("connections/:id")
  async toggleConnection(@Param("id") id: string, @Body() body: { enabled: boolean }) {
    if (!CONNECTIONS.find((c) => c.id === id)) throw new NotFoundException(`Unknown connection "${id}"`);
    const disabled = this.settings.getDisabledConnections();
    if (body.enabled) {
      this.settings.setDisabledConnections(disabled.filter((x) => x !== id));
    } else if (!disabled.includes(id)) {
      this.settings.setDisabledConnections([...disabled, id]);
    }

    // Apply immediately: disabling stops all running bots of that type;
    // enabling restarts the users who had it on. (Google has no live process.)
    if (body.enabled) {
      if (id === "telegram") this.telegram.startAllEnabled();
      else if (id === "discord") this.discord.startAllEnabled();
      else if (id === "slack") this.slack.startAllEnabled();
    } else {
      if (id === "telegram") this.telegram.stopAllRunning();
      else if (id === "discord") this.discord.stopAllRunning();
      else if (id === "slack") await this.slack.stopAllRunning();
    }
    return this.getConnections();
  }

  // ── Danger zone ───────────────────────────────────────────────────────────

  /**
   * Wipe ALL user data and return to a clean slate.
   * Schema is preserved — the app recreates tables on next boot.
   * Requires the admin to confirm with the word "reset".
   */
  @Delete("reset")
  @HttpCode(200)
  resetAll(@Body() body: { confirm?: string }) {
    if (body?.confirm !== "reset") {
      throw new BadRequestException('Send { "confirm": "reset" } to confirm');
    }
    // Delete in dependency order (foreign keys are ON)
    this.db.pragma("foreign_keys = OFF");
    for (const table of [
      "memories", "chat_summaries", "messages",
      "chats", "api_keys", "sessions", "settings", "users",
    ]) {
      this.db.prepare(`DELETE FROM ${table}`).run();
    }
    this.db.pragma("foreign_keys = ON");
    return { ok: true, message: "All data wiped. The app is ready for a fresh start." };
  }
}
