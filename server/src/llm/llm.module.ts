import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { OllamaProvider } from "./ollama.provider";
import { LlmService } from "./llm.service";

@Module({
  imports: [ApiKeysModule],
  providers: [OllamaProvider, LlmService],
  exports: [LlmService, OllamaProvider],
})
export class LlmModule {}
