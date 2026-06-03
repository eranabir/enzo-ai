import { Injectable } from "@nestjs/common";
import { OllamaProvider } from "./ollama.provider";
import { OpenAIProvider } from "./providers/openai.provider";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { GeminiProvider } from "./providers/google.provider";
import type { ChatProvider, ModelInfo } from "./provider.types";
import { ApiKeysService } from "../api-keys/api-keys.service";
import type { Provider } from "../api-keys/api-keys.service";

@Injectable()
export class LlmService {
  constructor(
    public readonly ollama: OllamaProvider,
    private readonly apiKeys: ApiKeysService,
  ) {}

  getProvider(id: string): ChatProvider | undefined {
    if (id === "ollama") return this.ollama;
    return undefined;
  }

  /**
   * Resolve which provider handles a given model ID and return an instance
   * configured with the user's API key. Returns null if the key isn't set.
   */
  async resolveProvider(
    modelId: string,
    userId: string,
  ): Promise<ChatProvider | null> {
    const prefix = modelId.split(":")[0] as Provider | "ollama";

    if (prefix === "openai") {
      const key = this.apiKeys.getKey(userId, "openai");
      return key ? new OpenAIProvider(key) : null;
    }
    if (prefix === "anthropic") {
      const key = this.apiKeys.getKey(userId, "anthropic");
      return key ? new AnthropicProvider(key) : null;
    }
    if (prefix === "google") {
      const key = this.apiKeys.getKey(userId, "google");
      return key ? new GeminiProvider(key) : null;
    }

    // Default: local Ollama
    return this.ollama;
  }

  /**
   * Aggregate models across every available provider (local + configured external).
   * userId is needed to check which external providers have keys configured.
   */
  async listAllModels(userId?: string): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    // Local models
    try {
      if (await this.ollama.isAvailable()) {
        models.push(...(await this.ollama.listModels()));
      }
    } catch { /* ignore */ }

    // External providers — fetch live model list from each provider's API
    if (userId) {
      const configured = this.apiKeys.listProviders(userId);
      await Promise.all(configured.map(async (provider) => {
        try {
          const key = this.apiKeys.getKey(userId, provider as "openai" | "anthropic" | "google");
          if (!key) return;
          let providerModels: ModelInfo[] = [];
          if (provider === "openai")    providerModels = await new OpenAIProvider(key).listModels();
          if (provider === "anthropic") providerModels = await new AnthropicProvider(key).listModels();
          if (provider === "google")    providerModels = await new GeminiProvider(key).listModels();
          models.push(...providerModels);
        } catch { /* ignore */ }
      }));
    }

    return models;
  }
}
