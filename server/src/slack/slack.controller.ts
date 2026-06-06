import { Body, Controller, Delete, Get, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { SlackService } from "./slack.service";

/** Per-user Slack integration — each user connects their own app. */
@Controller("integrations/slack")
@UseGuards(AuthGuard)
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.slack.getStatus(userId);
  }

  @Put()
  async save(
    @UserId() userId: string,
    @Body() body: { botToken?: string; appToken?: string; allowedIds?: string; model?: string },
  ) {
    this.slack.updateConfig(userId, body);
    const hasBoth = this.slack.getStatus(userId).botToken && this.slack.getStatus(userId).appToken;
    if ((body.botToken?.trim() || body.appToken?.trim()) && hasBoth) {
      const { botName } = await this.slack.start(userId, true);
      return { ok: true, running: true, botName };
    }
    return { ok: true, running: this.slack.isRunning(userId) };
  }

  @Delete()
  async disconnect(@UserId() userId: string) {
    await this.slack.stop(userId);
    this.slack.deleteConversation(userId);
    this.slack.clearConfig(userId);
    return { ok: true, running: false };
  }
}
