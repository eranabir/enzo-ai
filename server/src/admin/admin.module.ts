import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { SettingsModule } from "../settings/settings.module";
import { LlmModule } from "../llm/llm.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [AuthModule, UsersModule, SettingsModule, LlmModule],
  controllers: [AdminController],
})
export class AdminModule {}
