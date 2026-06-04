import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { UsersModule } from "../users/users.module";
import { AgentsModule } from "../agents/agents.module";
import { SlackService } from "./slack.service";

@Module({
  imports: [SettingsModule, ConversationsModule, UsersModule, AgentsModule],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
