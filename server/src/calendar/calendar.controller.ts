import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { CalendarService } from "./calendar.service";

function getRedirectBase(req: Request): string {
  // In prod: same origin. In dev: server port.
  const proto  = req.headers["x-forwarded-proto"] ?? req.protocol ?? "http";
  const host   = req.headers.host ?? "localhost:1616";
  return `${proto}://${host}`;
}

@Controller("calendar")
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** Current connection status for the logged-in user. */
  @Get("status")
  status(@UserId() userId: string) {
    return {
      configured: this.calendar.isConfigured(),
      ...this.calendar.getTokenInfo(userId),
    };
  }

  /** Start OAuth — returns the Google login URL. */
  @Get("auth/url")
  authUrl(@UserId() userId: string, @Req() req: Request) {
    if (!this.calendar.isConfigured()) {
      throw new BadRequestException(
        "Google OAuth credentials not configured. Set Client ID and Secret in Admin → Settings."
      );
    }
    return { url: this.calendar.getAuthUrl(userId, getRedirectBase(req)) };
  }

  /** OAuth callback — exchanges code for tokens, then closes the popup. */
  @Get("callback")
  async callback(
    @Query("code")  code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (error) {
      return res.send(closePopupHtml(`Google OAuth error: ${error}`));
    }
    try {
      const userId = Buffer.from(state, "base64").toString("utf-8");
      const tokens = await this.calendar.handleCallback(code, userId, getRedirectBase(req));
      return res.send(closePopupHtml(null, tokens.email));
    } catch (e) {
      return res.send(closePopupHtml((e as Error).message));
    }
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

/** HTML page that posts a message to the opener and closes itself. */
function closePopupHtml(error: string | null, email?: string): string {
  const payload = error
    ? JSON.stringify({ ok: false, error })
    : JSON.stringify({ ok: true, email });
  return `<!DOCTYPE html><html><head><title>Google Calendar</title></head><body>
<script>
  window.opener?.postMessage(${payload}, '*');
  window.close();
</script>
<p>${error ? `❌ ${error}` : `✅ Connected as ${email}. You can close this window.`}</p>
</body></html>`;
}
