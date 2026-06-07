import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VaultModule } from "../vault/vault.module";
import { ChatsService } from "./chats.service";
import { ChatsController } from "./chats.controller";

@Module({
  imports: [AuthModule, VaultModule],
  providers: [ChatsService],
  controllers: [ChatsController],
  exports: [ChatsService],
})
export class ChatsModule {}
