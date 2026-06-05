import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { config } from "../config";
import { LlmService } from "../llm/llm.service";

@Controller("models")
export class ModelsController {
  constructor(private readonly llm: LlmService) {}

  /** List models for the authenticated user (local + their configured external providers). */
  @Get()
  @UseGuards(AuthGuard)
  async list(@UserId() userId: string) {
    return { models: await this.llm.listAllModels(userId), default: config.defaultModel };
  }

  /**
   * Public status for the pre-login UI: is the local engine reachable, and how
   * many local models are installed. The full model list is auth-gated, but an
   * unauthenticated count lets the welcome screen show the truth (0 on a fresh
   * install) instead of guessing.
   */
  @Get("status")
  async status() {
    const ollama = await this.llm.ollama.isAvailable();
    const models = ollama
      ? (await this.llm.ollama.listModels().catch(() => [])).length
      : 0;
    return { ollama, models };
  }

  /**
   * Pull a model, streaming progress to the UI via SSE. Lets a user download
   * a new local model without leaving Enzo AI.
   */
  @Post("pull")
  async pull(@Body() body: { model?: string }, @Res() res: Response) {
    const model = String(body?.model ?? "").trim();
    if (!model) {
      res.status(400).json({ error: "model is required" });
      return;
    }

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
}
