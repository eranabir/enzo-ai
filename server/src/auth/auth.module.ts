import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { AuthController } from "./auth.controller";

/** Exports AuthService + AuthGuard so other modules can protect their routes. */
@Module({
  imports: [UsersModule],
  providers: [AuthService, AuthGuard],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
