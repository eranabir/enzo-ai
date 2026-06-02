import { Injectable } from "@nestjs/common";
import { OllamaProvider } from "./ollama.provider";
import type { ChatProvider, ModelInfo } from "./provider.types";

/**
 * Registry of model providers. Today only Ollama (local). To add external
 * models later, create an @Injectable provider, inject it here, and push it
 * into `providers` — controllers and UI need no changes.
 */
@Injectable()
export class LlmService {
  private readonly providers: ChatProvider[];

  constructor(public readonly ollama: OllamaProvider) {
    this.providers = [ollama];
  }

  getProvider(id: string): ChatProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  /** Aggregate models across every available provider. */
  async listAllModels(): Promise<ModelInfo[]> {
    const results = await Promise.all(
      this.providers.map(async (p) => {
        try {
          return (await p.isAvailable()) ? await p.listModels() : [];
        } catch {
          return [];
        }
      }),
    );
    return results.flat();
  }
}
