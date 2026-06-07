import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { VaultService } from "./vault.service";

/**
 * Encryption ("vault") control. Status is readable by any signed-in user so the
 * UI can show the unlock screen; setup / unlock / change are admin-only — the
 * passphrase is the admin's to manage.
 */
@Controller("vault")
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get("status")
  @UseGuards(AuthGuard)
  status() {
    return this.vault.status();
  }

  @Post("setup")
  @UseGuards(AdminGuard)
  setup(@Body() body: { passphrase?: string }) {
    try {
      const { recoveryKey } = this.vault.setup(String(body?.passphrase ?? ""));
      return { ok: true, recoveryKey, ...this.vault.status() };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Post("unlock")
  @UseGuards(AdminGuard)
  unlock(@Body() body: { secret?: string }) {
    try {
      this.vault.unlock(String(body?.secret ?? ""));
    } catch (e) {
      throw new UnauthorizedException((e as Error).message);
    }
    return { ok: true, ...this.vault.status() };
  }

  @Post("lock")
  @UseGuards(AdminGuard)
  lock() {
    this.vault.lock();
    return { ok: true, ...this.vault.status() };
  }

  @Post("change-passphrase")
  @UseGuards(AdminGuard)
  change(@Body() body: { passphrase?: string }) {
    try {
      this.vault.changePassphrase(String(body?.passphrase ?? ""));
      return { ok: true };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
