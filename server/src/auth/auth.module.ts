import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { AdminGuard } from "./admin.guard";
import { AuthController } from "./auth.controller";

/** Exports AuthService, AuthGuard, AdminGuard so other modules can protect their routes. */
@Module({
  imports: [UsersModule],
  providers: [AuthService, AuthGuard, AdminGuard],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
