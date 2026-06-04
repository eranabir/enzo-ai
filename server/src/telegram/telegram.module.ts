import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { UsersModule } from "../users/users.module";
import { AgentsModule } from "../agents/agents.module";
import { TelegramService } from "./telegram.service";

@Module({
  imports: [SettingsModule, ConversationsModule, UsersModule, AgentsModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
