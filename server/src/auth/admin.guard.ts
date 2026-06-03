import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { AuthGuard } from "./auth.guard";

/** Requires the request to be authenticated AND the user to have role=admin. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly authGuard: AuthGuard,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await this.authGuard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest<{ userId: string }>();
    const user = this.users.findById(req.userId);
    if (user?.role !== "admin") throw new ForbiddenException("Admin only");
    return true;
  }
}
