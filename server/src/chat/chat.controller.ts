import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
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
    @Body() body: {
      conversationId?: string;
      content?: string;
      model?: string;
      imageBase64?: string;
      imageMime?: string;
    },
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
      body?.imageBase64,
      body?.imageMime,
    )) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }

  /** Serve a message's attached image (auth-gated via conversation ownership). */
  @Get("image/:messageId")
  async getImage(
    @UserId() userId: string,
    @Param("messageId") messageId: string,
    @Res() res: Response,
  ) {
    // Verify message belongs to a conversation owned by this user
    const ref = this.convos.getMessageConversation(messageId);
    if (!ref) throw new NotFoundException("Message not found");
    const convo = this.convos.get(ref.conversation_id, userId);
    if (!convo) throw new NotFoundException("Not authorized");

    // Get the mime from the messages table
    const msgRow = this.convos.listMessages(ref.conversation_id)
      .find((m) => m.id === messageId);
    if (!msgRow?.image_mime) throw new NotFoundException("No image on this message");

    const buffer = await this.chat.getImageBuffer(messageId, msgRow.image_mime);
    if (!buffer) throw new NotFoundException("Image file not found");

    res.setHeader("Content-Type", msgRow.image_mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buffer);
  }
}
