import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth/auth.guard";
import { UserId } from "./auth/current-user.decorator";
import { TelegramService } from "./telegram/telegram.service";
import { DiscordService } from "./discord/discord.service";
import { SlackService } from "./slack/slack.service";

@Controller("health")
export class AppController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly discord: DiscordService,
    private readonly slack: SlackService,
  ) {}

  @Get()
  health() {
    return { ok: true, name: "enzo-ai" };
  }

  /** Which integrations are usable as outbound delivery targets for this user:
   *  enabled by admin and configured with a token. This is intentionally NOT
   *  isRunning() — sending a scheduled result only needs the token, so a
   *  configured-but-not-polling bot (common in dev, or when another process
   *  holds the poll) must still be selectable. Auth-gated, not admin-only. */
  @Get("/integrations")
  @UseGuards(AuthGuard)
  integrations(@UserId() userId: string) {
    return {
      telegram: this.telegram.isConfigured(userId),
      discord:  this.discord.isConfigured(userId),
      slack:    this.slack.isConfigured(userId),
    };
  }
}
