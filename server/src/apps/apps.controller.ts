import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { CalendarService } from "../calendar/calendar.service";
import { GmailService } from "../gmail/gmail.service";

function getRedirectBase(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "http";
  const host = req.headers.host ?? "localhost:1616";
  return `${proto}://${host}`;
}

/**
 * Generic OAuth callback hub for connector apps.
 *
 * All apps redirect to a single, predictable path: `/api/apps/{appId}/callback`.
 * This route is intentionally NOT behind AuthGuard — the browser redirect from
 * the provider (Google, Slack, …) cannot carry our session header. Instead the
 * user is identified by the `state` param (base64-encoded userId) created when
 * the auth URL was generated.
 */
@Controller("apps")
export class AppsController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly gmail: GmailService,
  ) {}

  @Get(":appId/callback")
  async callback(
    @Param("appId") appId: string,
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const appName = APP_LABELS[appId] ?? appId;

    if (error) {
      return res.send(closePopupHtml(appName, `${appName} OAuth error: ${error}`));
    }

    try {
      const userId = Buffer.from(state, "base64").toString("utf-8");
      const base = getRedirectBase(req);

      switch (appId) {
        case "google-calendar": {
          const tokens = await this.calendar.handleCallback(code, userId, base);
          return res.send(closePopupHtml(appName, null, tokens.email));
        }
        case "google-gmail": {
          const tokens = await this.gmail.handleCallback(code, userId, base);
          return res.send(closePopupHtml(appName, null, tokens.email));
        }
        default:
          return res.send(closePopupHtml(appName, `Unknown app "${appId}"`));
      }
    } catch (e) {
      return res.send(closePopupHtml(appName, (e as Error).message));
    }
  }
}

const APP_LABELS: Record<string, string> = {
  "google-calendar": "Google Calendar",
  "google-gmail": "Gmail",
};

/** HTML page that posts a message to the opener and closes itself. */
function closePopupHtml(appName: string, error: string | null, email?: string): string {
  const payload = error
    ? JSON.stringify({ ok: false, error })
    : JSON.stringify({ ok: true, email });
  return `<!DOCTYPE html><html><head><title>${appName}</title></head><body>
<script>
  window.opener?.postMessage(${payload}, '*');
  window.close();
</script>
<p>${error ? `❌ ${error}` : `✅ Connected as ${email}. You can close this window.`}</p>
</body></html>`;
}
