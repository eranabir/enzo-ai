import {
  Body,
  Controller,
  Get,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { config } from "../config";
import { LlmService } from "../llm/llm.service";

@Controller("models")
export class ModelsController {
  constructor(private readonly llm: LlmService) {}

  /** List every model available across providers, plus the default. */
  @Get()
  async list() {
    return { models: await this.llm.listAllModels(), default: config.defaultModel };
  }

  /** Is the local engine (Ollama) reachable? Drives the UI status indicator. */
  @Get("status")
  async status() {
    return { ollama: await this.llm.ollama.isAvailable() };
  }

  /**
   * Pull a model, streaming progress to the UI via SSE. Lets a user download
   * a new local model without leaving Enzo.
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
}
