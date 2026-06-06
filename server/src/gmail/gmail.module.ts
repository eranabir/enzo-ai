import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { GmailService } from "./gmail.service";
import { GmailController } from "./gmail.controller";

@Module({
  imports: [AuthModule, SettingsModule],
  providers: [GmailService],
  controllers: [GmailController],
  exports: [GmailService],
})
export class GmailModule {}
