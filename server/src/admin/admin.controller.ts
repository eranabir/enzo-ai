import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AdminGuard } from "../auth/admin.guard";
import { UsersService } from "../users/users.service";
import { SettingsService } from "../settings/settings.service";
import { LlmService } from "../llm/llm.service";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
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
  async listModels() {
    const [models, status] = await Promise.all([
      this.llm.listAllModels(),
      this.llm.ollama.isAvailable(),
    ]);
    return {
      models,
      ollamaOnline: status,
      defaultModel: this.settings.getDefaultModel(),
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
}
