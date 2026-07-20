import { Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./database/database.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { SettingsModule } from "./settings/settings.module";
import { LlmModule } from "./llm/llm.module";
import { ChatsModule } from "./chats/chats.module";
import { ModelsModule } from "./models/models.module";
import { ChatModule } from "./chat/chat.module";
import { MemoriesModule } from "./memories/memories.module";
import { AgentsModule } from "./agents/agents.module";
import { SystemModule } from "./system/system.module";
import { AdminModule } from "./admin/admin.module";
import { SchedulerService } from "./agents/scheduler.service";
import { AgentsService } from "./agents/agents.service";
import { ChatService } from "./chat/chat.service";
import { TelegramModule } from "./telegram/telegram.module";
import { TelegramService } from "./telegram/telegram.service";
import { DiscordModule } from "./discord/discord.module";
import { DiscordService } from "./discord/discord.service";
import { SlackModule } from "./slack/slack.module";
import { SlackService } from "./slack/slack.service";
import { CalendarModule } from "./calendar/calendar.module";
import { GmailModule } from "./gmail/gmail.module";
import { AppsModule } from "./apps/apps.module";
import { McpModule } from "./mcp/mcp.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { VaultModule } from "./vault/vault.module";
import { VaultService } from "./vault/vault.service";

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    AuthModule,
    ApiKeysModule,
    SettingsModule,
    LlmModule,
    ChatsModule,
    ModelsModule,
    ChatModule,
    MemoriesModule,
    AgentsModule,
    SystemModule,
    AdminModule,
    TelegramModule,
    DiscordModule,
    SlackModule,
    CalendarModule,
    GmailModule,
    AppsModule,
    McpModule,
    KnowledgeModule,
    VaultModule,
  ],
  controllers: [AppController],
  // AppController needs TelegramService + DiscordService for /api/health/integrations
})
export class AppModule implements OnModuleInit {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Wire lazy runners after all modules are ready (avoids circular deps). */
  onModuleInit() {
    const chat = this.moduleRef.get(ChatService, { strict: false });

    // Scheduler → ChatService (+ Telegram delivery for agents with linked chats)
    const scheduler  = this.moduleRef.get(SchedulerService, { strict: false });
    const telegramSvc = this.moduleRef.get(TelegramService, { strict: false });
    if (scheduler && chat) {
      scheduler.setRunner(async (agentId, userId, prompt) => {
        const result = await chat.runScheduledAgent(agentId, userId, prompt);
        // If this agent has Telegram chats linked, send the result there too
        if (telegramSvc && result) {
          const agentsSvc = this.moduleRef.get(AgentsService, { strict: false });
          const agent = agentsSvc?.list(userId).find((a) => a.id === agentId);
          if (agent?.telegram_chat_ids) {
            await telegramSvc.notifyAgentResult(userId, agent.telegram_chat_ids, result);
          }
        }
      });
    }

    // Telegram bot → ChatService. No model override — these are plain chats
    // like any other, so they use the chat's/agent's own configured model.
    const telegram = this.moduleRef.get(TelegramService, { strict: false });
    if (telegram && chat) {
      telegram.setRunner((userId, convoId, content) =>
        chat.processMessage(userId, convoId, content, undefined, "telegram"),
      );
    }

    // Discord bot → ChatService
    const discordSvc = this.moduleRef.get(DiscordService, { strict: false });
    if (discordSvc && chat) {
      discordSvc.setRunner((userId, convoId, content) =>
        chat.processMessage(userId, convoId, content, undefined, "discord"),
      );
    }

    // Slack bot → ChatService
    const slackSvc = this.moduleRef.get(SlackService, { strict: false });
    if (slackSvc && chat) {
      slackSvc.setRunner((userId, convoId, content) =>
        chat.processMessage(userId, convoId, content, undefined, "slack"),
      );
    }

    // ChatService → integrations: push web-sent replies back out to the linked
    // platform so the chat stays in sync both ways.
    if (chat) {
      chat.setIntegrationRelay(async (integration, userId, convoId, text) => {
        if (integration === "telegram") await telegram?.sendToChat(userId, convoId, text);
        else if (integration === "discord") await discordSvc?.sendToChat(userId, convoId, text);
        else if (integration === "slack") await slackSvc?.sendToChat(userId, convoId, text);
      });
    }

    // ── Encryption gate ──────────────────────────────────────────────────────
    // Bots write incoming messages into (possibly encrypted) chats, so they may
    // only run once the vault is ready (unencrypted, or unlocked). On a headless
    // NAS the vault auto-unlocks from ENZO_PASSPHRASE; otherwise bots start the
    // moment an admin unlocks via the UI.
    const vault = this.moduleRef.get(VaultService, { strict: false });
    const startBots = () => {
      telegram?.startAllEnabled();
      discordSvc?.startAllEnabled();
      slackSvc?.startAllEnabled();
    };
    if (vault) {
      vault.tryAutoUnlock();
      vault.onUnlock(startBots);
      if (vault.isReady()) startBots();
    } else {
      startBots();
    }
  }
}
