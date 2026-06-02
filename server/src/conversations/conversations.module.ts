import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConversationsService } from "./conversations.service";
import { ConversationsController } from "./conversations.controller";

@Module({
  imports: [AuthModule],
  providers: [ConversationsService],
  controllers: [ConversationsController],
  exports: [ConversationsService],
})
export class ConversationsModule {}
