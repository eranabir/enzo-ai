import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { ConversationsService } from "../conversations/conversations.service";
import { ChatService } from "./chat.service";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    private readonly convos: ConversationsService,
    private readonly chat: ChatService,
  ) {}

  /**
   * Send a user message and stream the assistant reply over SSE.
   * Body: { conversationId, content, model? }
   */
  @Post()
  async send(
    @UserId() userId: string,
    @Body() body: { conversationId?: string; content?: string; model?: string },
    @Res() res: Response,
  ) {
    const convo = this.convos.get(String(body?.conversationId ?? ""), userId);
    const content = String(body?.content ?? "").trim();
    if (!convo) throw new NotFoundException("conversation not found");
    if (!content) throw new BadRequestException("content is required");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Abort the upstream model call only if the client disconnects mid-stream.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });

    for await (const event of this.chat.streamReply(
      convo,
      userId,
      content,
      body?.model,
      controller.signal,
    )) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }
}
