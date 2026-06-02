import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { ModelsController } from "./models.controller";

@Module({
  imports: [LlmModule],
  controllers: [ModelsController],
})
export class ModelsModule {}
