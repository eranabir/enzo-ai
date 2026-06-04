import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { CalendarModule } from "../calendar/calendar.module";
import { AgentsService } from "./agents.service";
import { ToolsService } from "./tools.service";
import { SchedulerService } from "./scheduler.service";
import { AgentsController } from "./agents.controller";

@Module({
  imports: [AuthModule, SettingsModule, CalendarModule],
  providers: [AgentsService, ToolsService, SchedulerService],
  controllers: [AgentsController],
  exports: [AgentsService, ToolsService, SchedulerService],
})
export class AgentsModule {}
