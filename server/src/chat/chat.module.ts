import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatsModule } from "../chats/chats.module";
import { LlmModule } from "../llm/llm.module";
import { UsersModule } from "../users/users.module";
import { SettingsModule } from "../settings/settings.module";
import { MemoriesModule } from "../memories/memories.module";
import { AgentsModule } from "../agents/agents.module";
import { McpModule } from "../mcp/mcp.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { SkillsModule } from "../skills/skills.module";
import { VaultModule } from "../vault/vault.module";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [AuthModule, ChatsModule, LlmModule, UsersModule, SettingsModule, MemoriesModule, AgentsModule, McpModule, KnowledgeModule, SkillsModule, VaultModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
