import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";

/**
 * Resolves the session and attaches req.userId. Reads the token from the
 * x-enzo-ai-token header (normal API calls) or, as a fallback, a `token` query
 * param — needed for media URLs (`<img src>`, document download `<a href>`)
 * that the browser loads directly and so cannot carry a custom header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = req.headers["x-enzo-ai-token"];
    const headerToken = Array.isArray(header) ? header[0] : header;
    const queryToken = typeof req.query?.token === "string" ? req.query.token : undefined;
    const token = headerToken || queryToken;
    const userId = this.auth.resolveUserId(token);
    if (!userId) throw new UnauthorizedException("Not signed in");
    req.userId = userId;
    return true;
  }
}
