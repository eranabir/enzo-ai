import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { UsersModule } from "../users/users.module";
import { VaultService } from "./vault.service";
import { VaultController } from "./vault.controller";

@Module({
  imports: [AuthModule, SettingsModule, UsersModule],
  providers: [VaultService],
  controllers: [VaultController],
  exports: [VaultService],
})
export class VaultModule {}
