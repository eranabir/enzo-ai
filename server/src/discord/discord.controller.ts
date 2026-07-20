import { Body, Controller, Delete, Get, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { DiscordService } from "./discord.service";

/** Per-user Discord integration — each user connects their own bot. */
@Controller("integrations/discord")
@UseGuards(AuthGuard)
export class DiscordController {
  constructor(private readonly discord: DiscordService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.discord.getStatus(userId);
  }

  @Put()
  async save(
    @UserId() userId: string,
    @Body() body: { token?: string; allowedIds?: string },
  ) {
    this.discord.updateConfig(userId, body);
    if (body.token?.trim()) {
      const { tag } = await this.discord.start(userId, true);
      return { ok: true, running: true, tag };
    }
    return { ok: true, running: this.discord.isRunning(userId) };
  }

  @Delete()
  disconnect(@UserId() userId: string) {
    this.discord.stop(userId);
    this.discord.deleteChat(userId);
    this.discord.clearConfig(userId);
    return { ok: true, running: false };
  }
}
