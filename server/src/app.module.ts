import { Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./database/database.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { SettingsModule } from "./settings/settings.module";
import { LlmModule } from "./llm/llm.module";
import { ConversationsModule } from "./conversations/conversations.module";
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

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    AuthModule,
    ApiKeysModule,
    SettingsModule,
    LlmModule,
    ConversationsModule,
    ModelsModule,
    ChatModule,
    MemoriesModule,
    AgentsModule,
    SystemModule,
    AdminModule,
    TelegramModule,
  ],
  controllers: [AppController],
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
            await telegramSvc.notifyAgentResult(agent.telegram_chat_ids, result);
          }
        }
      });
    }

    // Telegram bot → ChatService
    const telegram = this.moduleRef.get(TelegramService, { strict: false });
    if (telegram && chat) {
      telegram.setRunner((userId, convoId, content, model) =>
        chat.processMessage(userId, convoId, content, model),
      );
    }
  }
}
