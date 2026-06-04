import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth/auth.guard";
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

  /** Returns which integrations are currently connected (auth-gated, not admin-only). */
  @Get("/integrations")
  @UseGuards(AuthGuard)
  integrations() {
    return {
      telegram: this.telegram.isRunning(),
      discord:  this.discord.isRunning(),
      slack:    this.slack.isRunning(),
    };
  }
}
