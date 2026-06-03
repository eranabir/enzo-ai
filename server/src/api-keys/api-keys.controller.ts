import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { ApiKeysService, type Provider } from "./api-keys.service";

const VALID: Provider[] = ["openai", "anthropic", "google"];

@Controller("keys")
@UseGuards(AuthGuard)
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  /** Which providers have a key saved (not the key values). */
  @Get()
  list(@UserId() userId: string) {
    return { configured: this.keys.listProviders(userId) };
  }

  @Put(":provider")
  save(
    @UserId() userId: string,
    @Param("provider") provider: string,
    @Body() body: { key?: string },
  ) {
    if (!VALID.includes(provider as Provider)) {
      return { error: "unknown provider" };
    }
    const key = (body?.key ?? "").trim();
    if (!key) return { error: "key is required" };
    this.keys.setKey(userId, provider as Provider, key);
    return { ok: true };
  }

  @Delete(":provider")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("provider") provider: string) {
    if (VALID.includes(provider as Provider)) {
      this.keys.deleteKey(userId, provider as Provider);
    }
  }
}
