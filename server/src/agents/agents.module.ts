import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { AgentsService } from "./agents.service";
import { ToolsService } from "./tools.service";
import { SchedulerService } from "./scheduler.service";
import { AgentsController } from "./agents.controller";

@Module({
  imports: [AuthModule, SettingsModule],
  providers: [AgentsService, ToolsService, SchedulerService],
  controllers: [AgentsController],
  exports: [AgentsService, ToolsService, SchedulerService],
})
export class AgentsModule {}
