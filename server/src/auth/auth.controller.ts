import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { UserId } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  /** List local profiles for the login picker (no secrets). Public. */
  @Get("profiles")
  profiles() {
    return this.users.listProfiles();
  }

  /** Register a new local user + their onboarding profile. */
  @Post("register")
  register(
    @Body()
    body: {
      username?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      nickname?: string;
      superPowers?: string;
      about?: string;
      assistantStyle?: string;
      pin?: string;
    },
  ) {
    const username = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "");
    if (username.length < 2)
      throw new BadRequestException("Username must be at least 2 characters");
    if (password.length < 4)
      throw new BadRequestException("Password must be at least 4 characters");
    if (body?.pin && !/^\d{4,8}$/.test(body.pin))
      throw new BadRequestException("PIN must be 4–8 digits");

    const user = this.users.create({
      username,
      password,
      displayName: "",           // auto-derived from name fields in UsersService
      firstName: body?.firstName,
      lastName: body?.lastName,
      nickname: body?.nickname,
      superPowers: body?.superPowers,
      about: body?.about,
      assistantStyle: body?.assistantStyle,
      pin: body?.pin,
    });
    return { token: this.auth.createSession(user.id), user: this.users.toPublic(user) };
  }

  /** Sign in by username (or selected profile) with password or PIN. */
  @Post("login")
  login(
    @Body()
    body: { username?: string; password?: string; pin?: string },
  ) {
    const user = this.users.findByUsername(String(body?.username ?? "").trim());
    if (!user || !this.users.verifyCredential(user, body ?? {}))
      throw new UnauthorizedException("Wrong username, password, or PIN");
    return { token: this.auth.createSession(user.id), user: this.users.toPublic(user) };
  }

  /** Current signed-in user. */
  @Get("me")
  @UseGuards(AuthGuard)
  me(@UserId() userId: string) {
    const user = this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return { user: this.users.toPublic(user) };
  }

  /** Update the profile (settings panel). */
  @Patch("me")
  @UseGuards(AuthGuard)
  updateMe(
    @UserId() userId: string,
    @Body()
    body: {
      displayName?: string;
      firstName?: string;
      lastName?: string;
      nickname?: string;
      superPowers?: string;
      about?: string;
      assistantStyle?: string;
    },
  ) {
    this.users.updateProfile(userId, body ?? {});
    return { user: this.users.toPublic(this.users.findById(userId)!) };
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  logout(@Headers("x-enzo-ai-token") token: string) {
    if (token) this.auth.destroySession(token);
  }

  // ── CLI browser sign-in (see AuthService for the flow) ──────────────────────

  /** CLI: mint a one-time code to show in the browser. Public. */
  @Post("cli/start")
  cliStart() {
    return this.auth.cliAuthStart();
  }

  /** Web UI: a signed-in user approves the waiting CLI. */
  @Post("cli/approve")
  @UseGuards(AuthGuard)
  cliApprove(@UserId() userId: string, @Body() body: { code?: string }) {
    const ok = this.auth.cliAuthApprove(String(body?.code ?? ""), userId);
    if (!ok) throw new BadRequestException("This sign-in request is invalid, expired, or already used.");
    return { ok: true };
  }

  /** CLI: poll until approved. Public — the code itself is the secret. */
  @Post("cli/poll")
  cliPoll(@Body() body: { code?: string }) {
    const res = this.auth.cliAuthPoll(String(body?.code ?? ""));
    if (res.status !== "approved") return { status: res.status };
    const userId = this.auth.resolveUserId(res.token)!;
    const user = this.users.findById(userId);
    return { status: "approved", token: res.token, user: user ? this.users.toPublic(user) : undefined };
  }
}
