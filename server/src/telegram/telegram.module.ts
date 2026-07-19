import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { ChatsModule } from "../chats/chats.module";
import { UsersModule } from "../users/users.module";
import { AgentsModule } from "../agents/agents.module";
import { AuthModule } from "../auth/auth.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { TelegramService } from "./telegram.service";
import { TelegramController } from "./telegram.controller";

@Module({
  imports: [SettingsModule, ChatsModule, UsersModule, AgentsModule, AuthModule, KnowledgeModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
