import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";

/** Reads the x-enzo-token header, resolves the session, attaches req.userId. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = req.headers["x-enzo-token"];
    const token = Array.isArray(header) ? header[0] : header;
    const userId = this.auth.resolveUserId(token);
    if (!userId) throw new UnauthorizedException("Not signed in");
    req.userId = userId;
    return true;
  }
}
