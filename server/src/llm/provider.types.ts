import type { Role } from "../database/database.types";

export interface ChatMessage {
  role: Role;
  content: string;
  /** Base64-encoded image data (without data-URI prefix), if any. */
  imageData?: string;
  /** MIME type of the image, e.g. "image/jpeg". */
  imageMime?: string;
}

export interface ModelInfo {
  id: string;
  /** Provider this model belongs to, e.g. "ollama" or "openai" later. */
  provider: string;
  /** Optional human label / size hint. */
  label?: string;
  /** Whether the model supports function/tool calling. */
  supportsTools: boolean;
  /** Whether the model can understand image inputs. */
  supportsVision: boolean;
  /**
   * Whether the model can hold a chat (text generation). False for
   * embedding-only models like nomic-embed-text, which must be hidden from the
   * chat/agent pickers. Omitted (undefined) is treated as chat-capable.
   */
  supportsChat?: boolean;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Context window for local Ollama requests (admin-configurable);
   *  providers that don't support it ignore it. */
  numCtx?: number;
}

/**
 * The single interface every model backend implements. The UI never knows
 * whether it is talking to a local Ollama model or an external API later —
 * it just asks Enzo AI to chat. To add OpenAI/Anthropic, create an @Injectable
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
