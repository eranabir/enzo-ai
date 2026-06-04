import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { UsersModule } from "../users/users.module";
import { SettingsModule } from "../settings/settings.module";
import { LlmModule } from "../llm/llm.module";
import { AgentsModule } from "../agents/agents.module";
import { TelegramModule } from "../telegram/telegram.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [AuthModule, ApiKeysModule, UsersModule, SettingsModule, LlmModule, AgentsModule, TelegramModule],
  controllers: [AdminController],
})
export class AdminModule {}
