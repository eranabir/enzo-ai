import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { CalendarService } from "./calendar.service";

function getRedirectBase(req: Request): string {
  // In prod: same origin. In dev: server port.
  const proto  = req.headers["x-forwarded-proto"] ?? req.protocol ?? "http";
  const host   = req.headers.host ?? "localhost:1616";
  return `${proto}://${host}`;
}

@Controller("google-calendar")
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** Current connection status + whether user has set their own credentials. */
  @Get("status")
  status(@UserId() userId: string) {
    return {
      hasCredentials: this.calendar.hasCredentials(userId),
      ...this.calendar.getTokenInfo(userId),
    };
  }

  /** Save per-user Google OAuth credentials. */
  @Put("credentials")
  saveCredentials(
    @UserId() userId: string,
    @Body() body: { clientId: string; clientSecret: string },
  ) {
    if (!body.clientId?.trim() || !body.clientSecret?.trim()) {
      throw new BadRequestException("Client ID and Client Secret are required");
    }
    this.calendar.setCredentials(userId, body.clientId, body.clientSecret);
    return { ok: true };
  }

  /** Start OAuth — returns the Google login URL. */
  @Get("auth/url")
  authUrl(@UserId() userId: string, @Req() req: Request) {
    if (!this.calendar.isConfigured(userId)) {
      throw new BadRequestException(
        "Set your Google OAuth Client ID and Secret first."
      );
    }
    return { url: this.calendar.getAuthUrl(userId, getRedirectBase(req)) };
  }

  /** Disconnect Google Calendar. */
  @Delete()
  disconnect(@UserId() userId: string) {
    this.calendar.disconnect(userId);
    return { ok: true };
  }

  /** Get upcoming events (for use by tools/agents). */
  @Get("events")
  async events(@UserId() userId: string, @Query("days") days?: string) {
    const events = await this.calendar.getUpcomingEvents(userId, Number(days ?? 7));
    return { events };
  }
}
