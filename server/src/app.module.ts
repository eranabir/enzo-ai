import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./database/database.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { SettingsModule } from "./settings/settings.module";
import { LlmModule } from "./llm/llm.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { ModelsModule } from "./models/models.module";
import { ChatModule } from "./chat/chat.module";
import { MemoriesModule } from "./memories/memories.module";
import { AdminModule } from "./admin/admin.module";

// In production the Electron process sets ENZO_WEB_DIR to the bundled
// web/dist path inside the app resources. In dev the Vite dev server
// runs separately, so we only mount serve-static when the path exists.
const webDir =
  process.env.ENZO_WEB_DIR ||
  join(__dirname, "..", "..", "web", "dist");

@Module({
  imports: [
    // Serve built web assets in production. Falls back gracefully in dev
    // (directory might not exist) since Vite handles it there.
    ...(require("node:fs").existsSync(webDir)
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDir,
            exclude: ["/api/{*path}"],
          }),
        ]
      : []),
    DatabaseModule,
    UsersModule,
    AuthModule,
    SettingsModule,
    LlmModule,
    ConversationsModule,
    ModelsModule,
    ChatModule,
    MemoriesModule,
    AdminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
