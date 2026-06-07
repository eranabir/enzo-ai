import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { ChatsModule } from "../chats/chats.module";
import { UsersModule } from "../users/users.module";
import { AgentsModule } from "../agents/agents.module";
import { AuthModule } from "../auth/auth.module";
import { SlackService } from "./slack.service";
import { SlackController } from "./slack.controller";

@Module({
  imports: [SettingsModule, ChatsModule, UsersModule, AgentsModule, AuthModule],
  controllers: [SlackController],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
