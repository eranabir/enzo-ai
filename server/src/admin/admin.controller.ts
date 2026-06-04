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
      for await (const status of this.llm.ollama.pullModel(model)) {
        res.write(`data: ${JSON.stringify({ status })}\n\n`);
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
  listTools() {
    return this.toolsSvc.getAllWithStatus();
  }

  @Patch("tools/:name")
  toggleTool(@Param("name") name: string, @Body() body: { enabled: boolean }) {
    const all = this.toolsSvc.getAllWithStatus();
    if (!all.find((t) => t.name === name)) throw new NotFoundException(`Tool "${name}" not found`);
    const disabled = this.settings.getDisabledTools();
    if (body.enabled) {
      this.settings.setDisabledTools(disabled.filter((t) => t !== name));
    } else {
      if (!disabled.includes(name)) this.settings.setDisabledTools([...disabled, name]);
    }
    return this.toolsSvc.getAllWithStatus();
  }

  // ── Telegram integration ──────────────────────────────────────────────────

  @Get("telegram")
  getTelegram() {
    return {
      enabled:    this.telegram.isRunning(),
      token:      this.settings.get("telegram_bot_token") ? "••••••••" : null,
      allowedIds: this.settings.get("telegram_allowed_ids") ?? "",
      model:      this.settings.get("telegram_model") ?? "",
    };
  }

  @Put("telegram")
  async saveTelegram(@Body() body: { token?: string; allowedIds?: string; model?: string; enabled?: boolean }) {
    if (body.token?.trim())    this.settings.set("telegram_bot_token", body.token.trim());
    if (body.allowedIds != null) this.settings.set("telegram_allowed_ids", String(body.allowedIds).trim());
    if (body.model != null)      this.settings.set("telegram_model", String(body.model).trim());

    if (body.enabled === true) {
      const token = this.settings.get("telegram_bot_token");
      if (!token) throw new BadRequestException("Save a bot token before starting the bot");
      await this.telegram.start();
    }
    if (body.enabled === false) this.telegram.stop();

    return { ok: true, running: this.telegram.isRunning() };
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
      "memories", "conversation_summaries", "messages",
      "conversations", "api_keys", "sessions", "settings", "users",
    ]) {
      this.db.prepare(`DELETE FROM ${table}`).run();
    }
    this.db.pragma("foreign_keys = ON");
    return { ok: true, message: "All data wiped. The app is ready for a fresh start." };
  }
}
