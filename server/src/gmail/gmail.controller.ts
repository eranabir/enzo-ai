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
import { GmailService } from "./gmail.service";
import { SettingsService } from "../settings/settings.service";

function getRedirectBase(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "http";
  const host  = req.headers.host ?? "localhost:1616";
  return `${proto}://${host}`;
}

@Controller("gmail")
@UseGuards(AuthGuard)
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
    private readonly settings: SettingsService,
  ) {}

  @Get("status")
  status(@UserId() userId: string) {
    return {
      available: this.settings.isConnectionEnabled("gmail"),
      hasCredentials: this.gmail.hasCredentials(userId),
      ...this.gmail.getTokenInfo(userId),
    };
  }

  @Put("credentials")
  saveCredentials(
    @UserId() userId: string,
    @Body() body: { clientId: string; clientSecret: string },
  ) {
    if (!body.clientId?.trim() || !body.clientSecret?.trim()) {
      throw new BadRequestException("Client ID and Client Secret are required");
    }
    this.gmail.setCredentials(userId, body.clientId, body.clientSecret);
    return { ok: true };
  }

  @Get("auth/url")
  authUrl(@UserId() userId: string, @Req() req: Request) {
    if (!this.gmail.isConfigured(userId)) {
      throw new BadRequestException("Set your Google OAuth Client ID and Secret first.");
    }
    return { url: this.gmail.getAuthUrl(userId, getRedirectBase(req)) };
  }

  @Delete()
  disconnect(@UserId() userId: string) {
    this.gmail.disconnect(userId);
    return { ok: true };
  }

  /** Search messages (for manual testing / debugging). */
  @Get("messages")
  async messages(@UserId() userId: string, @Query("q") q?: string, @Query("max") max?: string) {
    const emails = await this.gmail.searchEmails(userId, q ?? "", Number(max ?? 10));
    return { emails };
  }
}
