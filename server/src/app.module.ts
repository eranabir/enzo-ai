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
import { ChatService } from "./chat/chat.service";

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
  ],
  controllers: [AppController],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Wire SchedulerService → ChatService after all modules are ready. */
  onModuleInit() {
    const scheduler = this.moduleRef.get(SchedulerService, { strict: false });
    const chat = this.moduleRef.get(ChatService, { strict: false });
    if (scheduler && chat) {
      scheduler.setRunner((agentId, userId, prompt) =>
        chat.runScheduledAgent(agentId, userId, prompt),
      );
    }
  }
}
