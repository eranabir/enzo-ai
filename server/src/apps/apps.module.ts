import { Module } from "@nestjs/common";
import { CalendarModule } from "../calendar/calendar.module";
import { GmailModule } from "../gmail/gmail.module";
import { AppsController } from "./apps.controller";

/**
 * Hosts the generic `/api/apps/{appId}/callback` OAuth hub.
 * Add new connector apps by importing their module and extending the
 * dispatch switch in AppsController.
 */
@Module({
  imports: [CalendarModule, GmailModule],
  controllers: [AppsController],
})
export class AppsModule {}
