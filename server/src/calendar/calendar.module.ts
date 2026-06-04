import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { CalendarService } from "./calendar.service";
import { CalendarController } from "./calendar.controller";

@Module({
  imports: [AuthModule, SettingsModule, ApiKeysModule],
  providers: [CalendarService],
  controllers: [CalendarController],
  exports: [CalendarService],
})
export class CalendarModule {}
