import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { ModelsController } from "./models.controller";

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [ModelsController],
})
export class ModelsModule {}
