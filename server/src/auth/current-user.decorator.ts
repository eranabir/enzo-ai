import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** Injects the authenticated user's id (set by AuthGuard) into a handler. */
export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{ userId: string }>();
    return req.userId;
  },
);
