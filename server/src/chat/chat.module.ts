import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { LlmModule } from "../llm/llm.module";
import { UsersModule } from "../users/users.module";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [AuthModule, ConversationsModule, LlmModule, UsersModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
