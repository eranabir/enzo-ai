import { Body, Controller, Delete, Get, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { TelegramService } from "./telegram.service";

/**
 * Per-user Telegram integration. Each user connects their own bot; its messages
 * land in that user's chats and memory. Auth-gated, not admin-only.
 */
@Controller("integrations/telegram")
@UseGuards(AuthGuard)
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.telegram.getStatus(userId);
  }

  @Put()
  async save(
    @UserId() userId: string,
    @Body() body: { token?: string; allowedIds?: string; model?: string },
  ) {
    this.telegram.updateConfig(userId, body);
    if (body.token?.trim()) {
      const { username } = await this.telegram.start(userId, true);
      this.telegram.prepareChat(userId, username);
      return { ok: true, running: true, username };
    }
    return { ok: true, running: this.telegram.isRunning(userId) };
  }

  @Delete()
  disconnect(@UserId() userId: string) {
    this.telegram.stop(userId);
    this.telegram.deleteChat(userId);
    this.telegram.clearConfig(userId);
    return { ok: true, running: false };
  }
}
