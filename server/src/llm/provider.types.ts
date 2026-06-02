import type { Role } from "../database/database.types";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ModelInfo {
  id: string;
  /** Provider this model belongs to, e.g. "ollama" or "openai" later. */
  provider: string;
  /** Optional human label / size hint. */
  label?: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/**
 * The single interface every model backend implements. The UI never knows
 * whether it is talking to a local Ollama model or an external API later —
 * it just asks Enzo to chat. To add OpenAI/Anthropic, create an @Injectable
 * implementing this and register it in LlmService; nothing else changes.
 */
export interface ChatProvider {
  id: string;
  /** Is the underlying engine reachable right now? */
  isAvailable(): Promise<boolean>;
  /** Models this provider can serve. */
  listModels(): Promise<ModelInfo[]>;
  /** Stream assistant tokens as they are generated. */
  streamChat(opts: ChatOptions): AsyncIterable<string>;
}
