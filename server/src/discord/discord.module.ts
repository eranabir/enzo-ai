import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { ChatsModule } from "../chats/chats.module";
import { UsersModule } from "../users/users.module";
import { AgentsModule } from "../agents/agents.module";
import { AuthModule } from "../auth/auth.module";
import { DiscordService } from "./discord.service";
import { DiscordController } from "./discord.controller";

@Module({
  imports: [SettingsModule, ChatsModule, UsersModule, AgentsModule, AuthModule],
  controllers: [DiscordController],
  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
