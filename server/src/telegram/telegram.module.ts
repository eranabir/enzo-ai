import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { UsersModule } from "../users/users.module";
import { TelegramService } from "./telegram.service";

@Module({
  imports: [SettingsModule, ConversationsModule, UsersModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
