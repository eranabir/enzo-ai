import { Injectable, Logger } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

/** OAuth callback path id — must match the AppsController dispatch + the web apps registry. */
export const GMAIL_APP_ID = "google-gmail";

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface EmailFull extends EmailSummary {
  to: string;
  body: string;
}

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry: number; // unix ms
  email: string;
  name: string;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(private readonly settings: SettingsService) {}

  // ── OAuth config — per user ──────────────────────────────────────────────

  getClientId(userId: string)     { return this.settings.get(`gmail_client_id_${userId}`) ?? ""; }
  getClientSecret(userId: string) { return this.settings.get(`gmail_client_secret_${userId}`) ?? ""; }
  isConfigured(userId: string)    { return !!(this.getClientId(userId) && this.getClientSecret(userId)); }
  hasCredentials(userId: string)  { return this.isConfigured(userId); }

  setCredentials(userId: string, clientId: string, clientSecret: string): void {
    this.settings.set(`gmail_client_id_${userId}`, clientId.trim());
    this.settings.set(`gmail_client_secret_${userId}`, clientSecret.trim());
  }

  // ── OAuth flow ────────────────────────────────────────────────────────────

  getAuthUrl(userId: string, redirectBase: string): string {
    const state = Buffer.from(userId).toString("base64");
    const redirect = `${redirectBase}/api/apps/${GMAIL_APP_ID}/callback`;
    const params = new URLSearchParams({
      client_id:     this.getClientId(userId),
      redirect_uri:  redirect,
      response_type: "code",
      scope:         SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async handleCallback(code: string, userId: string, redirectBase: string): Promise<GoogleTokens> {
    const redirect = `${redirectBase}/api/apps/${GMAIL_APP_ID}/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     this.getClientId(userId),
        client_secret: this.getClientSecret(userId),
        redirect_uri:  redirect,
        grant_type:    "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    }
    const tokenData = await tokenRes.json() as {
      access_token: string; refresh_token?: string; expires_in: number;
    };

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

    this.settings.set(`gmail_tokens_${userId}`, JSON.stringify(tokens));
    this.logger.log(`Gmail connected for user ${userId}: ${userInfo.email}`);
    return tokens;
  }

  disconnect(userId: string): void {
    this.settings.set(`gmail_tokens_${userId}`, "");
  }

  getTokenInfo(userId: string): { connected: boolean; email?: string; name?: string } {
    const raw = this.settings.get(`gmail_tokens_${userId}`);
    if (!raw) return { connected: false };
    try {
      const tokens = JSON.parse(raw) as GoogleTokens;
      return { connected: true, email: tokens.email, name: tokens.name };
    } catch {
      return { connected: false };
    }
  }

  // ── Gmail API (read-only) ───────────────────────────────────────────────────

  /** Search/list messages. Empty query returns the most recent inbox messages. */
  async searchEmails(userId: string, query: string, maxResults = 10): Promise<EmailSummary[]> {
    const accessToken = await this.getValidAccessToken(userId);
    const n = Math.min(Math.max(maxResults, 1), 20);

    const listParams = new URLSearchParams({ maxResults: String(n) });
    if (query.trim()) listParams.set("q", query.trim());
    else listParams.set("q", "in:inbox");

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) throw new Error(`Gmail list error: ${listRes.status}`);
    const listData = await listRes.json() as { messages?: { id: string }[] };
    const ids = (listData.messages ?? []).map((m) => m.id);

    // Fetch metadata for each message (From / Subject / Date + snippet).
    const summaries = await Promise.all(ids.map(async (id) => {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?` +
        new URLSearchParams({
          format: "metadata",
        }) + "&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return null;
      const m = await res.json() as { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
      return { id: m.id, snippet: m.snippet ?? "", ...this.pickHeaders(m.payload?.headers) } as EmailSummary;
    }));

    return summaries.filter((s): s is EmailSummary => !!s);
  }

  /** Read a single message including its plain-text body. */
  async getEmail(userId: string, id: string): Promise<EmailFull> {
    const accessToken = await this.getValidAccessToken(userId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new Error(`Gmail get error: ${res.status}`);
    const m = await res.json() as {
      id: string; snippet?: string;
      payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: any[] };
    };
    const headers = this.pickHeaders(m.payload?.headers);
    const to = this.headerValue(m.payload?.headers, "To");
    const body = this.extractText(m.payload) || m.snippet || "";
    return { id: m.id, snippet: m.snippet ?? "", to, body, ...headers };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private pickHeaders(headers?: { name: string; value: string }[]): { from: string; subject: string; date: string } {
    return {
      from:    this.headerValue(headers, "From"),
      subject: this.headerValue(headers, "Subject") || "(no subject)",
      date:    this.headerValue(headers, "Date"),
    };
  }

  private headerValue(headers: { name: string; value: string }[] | undefined, name: string): string {
    return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  /** Recursively pull the first text/plain (fallback text/html) body out of a payload. */
  private extractText(payload: any): string {
    if (!payload) return "";
    const decode = (data?: string) =>
      data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8") : "";

    if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);

    if (Array.isArray(payload.parts)) {
      // Prefer plain text, then html, then recurse.
      const plain = payload.parts.find((p: any) => p.mimeType === "text/plain" && p.body?.data);
      if (plain) return decode(plain.body.data);
      const html = payload.parts.find((p: any) => p.mimeType === "text/html" && p.body?.data);
      if (html) return decode(html.body.data).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
      for (const part of payload.parts) {
        const nested = this.extractText(part);
        if (nested) return nested;
      }
    }
    return "";
  }

  // ── Token refresh ─────────────────────────────────────────────────────────

  private async getValidAccessToken(userId: string): Promise<string> {
    const raw = this.settings.get(`gmail_tokens_${userId}`);
    if (!raw) throw new Error("Gmail not connected for this user");
    const tokens = JSON.parse(raw) as GoogleTokens;
    if (Date.now() >= tokens.expiry - 60_000) {
      return this.refreshToken(tokens.refresh_token, userId, tokens);
    }
    return tokens.access_token;
  }

  private async refreshToken(refreshToken: string, userId: string, existing: GoogleTokens): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id:     this.getClientId(userId),
        client_secret: this.getClientSecret(userId),
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) throw new Error("Failed to refresh Google token");
    const data = await res.json() as { access_token: string; expires_in: number };
    const updated: GoogleTokens = { ...existing, access_token: data.access_token, expiry: Date.now() + data.expires_in * 1000 };
    this.settings.set(`gmail_tokens_${userId}`, JSON.stringify(updated));
    return data.access_token;
  }
}
