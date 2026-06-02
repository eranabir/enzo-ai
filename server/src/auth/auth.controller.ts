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
      displayName?: string;
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
      displayName: String(body?.displayName ?? "").trim() || username,
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

  /** Update the onboarding profile (editable later in settings). */
  @Patch("me")
  @UseGuards(AuthGuard)
  updateMe(
    @UserId() userId: string,
    @Body()
    body: { displayName?: string; about?: string; assistantStyle?: string },
  ) {
    this.users.updateProfile(userId, body ?? {});
    return { user: this.users.toPublic(this.users.findById(userId)!) };
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  logout(@Headers("x-enzo-token") token: string) {
    if (token) this.auth.destroySession(token);
  }
}
