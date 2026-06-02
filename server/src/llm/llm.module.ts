import { Module } from "@nestjs/common";
import { OllamaProvider } from "./ollama.provider";
import { LlmService } from "./llm.service";

/** Bundles model providers and the registry; exported for chat + models. */
@Module({
  providers: [OllamaProvider, LlmService],
  exports: [LlmService, OllamaProvider],
})
export class LlmModule {}
