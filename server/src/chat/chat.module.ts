import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { LlmModule } from "../llm/llm.module";
import { UsersModule } from "../users/users.module";
import { SettingsModule } from "../settings/settings.module";
import { MemoriesModule } from "../memories/memories.module";
import { AgentsModule } from "../agents/agents.module";
import { McpModule } from "../mcp/mcp.module";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [AuthModule, ConversationsModule, LlmModule, UsersModule, SettingsModule, MemoriesModule, AgentsModule, McpModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
