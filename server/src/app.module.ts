import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./database/database.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { LlmModule } from "./llm/llm.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { ModelsModule } from "./models/models.module";
import { ChatModule } from "./chat/chat.module";

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    AuthModule,
    LlmModule,
    ConversationsModule,
    ModelsModule,
    ChatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
