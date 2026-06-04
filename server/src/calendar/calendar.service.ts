import { Injectable, Logger } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { ApiKeysService } from "../api-keys/api-keys.service";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  allDay: boolean;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry: number; // unix ms
  email: string;
  name: string;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  // ── OAuth config ─────────────────────────────────────────────────────────

  getClientId()     { return this.settings.get("google_calendar_client_id") ?? ""; }
  getClientSecret() { return this.settings.get("google_calendar_client_secret") ?? ""; }
  isConfigured()    { return !!(this.getClientId() && this.getClientSecret()); }

  setCredentials(clientId: string, clientSecret: string): void {
    this.settings.set("google_calendar_client_id", clientId.trim());
    this.settings.set("google_calendar_client_secret", clientSecret.trim());
  }

  // ── OAuth flow ────────────────────────────────────────────────────────────

  /** Generate the Google OAuth URL to redirect the user to. */
  getAuthUrl(userId: string, redirectBase: string): string {
    const state = Buffer.from(userId).toString("base64");
    const redirect = `${redirectBase}/api/calendar/callback`;
    const params = new URLSearchParams({
      client_id:     this.getClientId(),
      redirect_uri:  redirect,
      response_type: "code",
      scope:         SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Exchange auth code for tokens, fetch user info, persist. */
  async handleCallback(code: string, userId: string, redirectBase: string): Promise<GoogleTokens> {
    const redirect = `${redirectBase}/api/calendar/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     this.getClientId(),
        client_secret: this.getClientSecret(),
        redirect_uri:  redirect,
        grant_type:    "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${err}`);
    }
    const tokenData = await tokenRes.json() as {
      access_token: string; refresh_token?: string;
      expires_in: number; token_type: string;
    };

    // Fetch user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userRes.json() as { email: string; name: string };

    const tokens: GoogleTokens = {
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? "",
      expiry:        Date.now() + tokenData.expires_in * 1000,
      email:         userInfo.email,
      name:          userInfo.name,
    };

    // Persist encrypted
    this.settings.set(`calendar_tokens_${userId}`, JSON.stringify(tokens));
    this.logger.log(`Google Calendar connected for user ${userId}: ${userInfo.email}`);
    return tokens;
  }

  /** Disconnect a user's Google Calendar. */
  disconnect(userId: string): void {
    this.settings.set(`calendar_tokens_${userId}`, "");
  }

  /** Get stored token info for a user. */
  getTokenInfo(userId: string): { connected: boolean; email?: string; name?: string } {
    const raw = this.settings.get(`calendar_tokens_${userId}`);
    if (!raw) return { connected: false };
    try {
      const tokens = JSON.parse(raw) as GoogleTokens;
      return { connected: true, email: tokens.email, name: tokens.name };
    } catch {
      return { connected: false };
    }
  }

  // ── Calendar API ──────────────────────────────────────────────────────────

  /** Get upcoming events (auto-refreshes token if expired). */
  async getUpcomingEvents(userId: string, days = 7): Promise<CalendarEvent[]> {
    const accessToken = await this.getValidAccessToken(userId);

    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin, timeMax,
        maxResults: "50",
        singleEvents: "true",
        orderBy: "startTime",
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);
    const data = await res.json() as { items?: any[] };

    return (data.items ?? []).map((item: any): CalendarEvent => ({
      id:          item.id,
      title:       item.summary ?? "(No title)",
      start:       item.start?.dateTime ?? item.start?.date ?? "",
      end:         item.end?.dateTime ?? item.end?.date ?? "",
      description: item.description,
      location:    item.location,
      allDay:      !!item.start?.date && !item.start?.dateTime,
    }));
  }

  // ── Token refresh ─────────────────────────────────────────────────────────

  private async getValidAccessToken(userId: string): Promise<string> {
    const raw = this.settings.get(`calendar_tokens_${userId}`);
    if (!raw) throw new Error("Google Calendar not connected for this user");

    const tokens = JSON.parse(raw) as GoogleTokens;

    // Refresh if expired (or within 60s of expiry)
    if (Date.now() >= tokens.expiry - 60_000) {
      const refreshed = await this.refreshToken(tokens.refresh_token, userId, tokens);
      return refreshed;
    }

    return tokens.access_token;
  }

  private async refreshToken(refreshToken: string, userId: string, existing: GoogleTokens): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id:     this.getClientId(),
        client_secret: this.getClientSecret(),
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) throw new Error("Failed to refresh Google token");
    const data = await res.json() as { access_token: string; expires_in: number };

    const updated: GoogleTokens = {
      ...existing,
      access_token: data.access_token,
      expiry:       Date.now() + data.expires_in * 1000,
    };
    this.settings.set(`calendar_tokens_${userId}`, JSON.stringify(updated));
    return data.access_token;
  }
}
