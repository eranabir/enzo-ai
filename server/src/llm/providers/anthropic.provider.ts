import type { ChatMessage, ChatOptions, ChatProvider, ModelInfo } from "../provider.types";

/** Fallback list if the API call fails. */
const FALLBACK_MODELS: ModelInfo[] = [
  { id: "anthropic:claude-opus-4-5",           provider: "anthropic", label: "Claude Opus 4",     supportsTools: true, supportsVision: true },
  { id: "anthropic:claude-sonnet-4-5",          provider: "anthropic", label: "Claude Sonnet 4",   supportsTools: true, supportsVision: true },
  { id: "anthropic:claude-3-5-sonnet-20241022", provider: "anthropic", label: "Claude 3.5 Sonnet", supportsTools: true, supportsVision: true },
  { id: "anthropic:claude-3-5-haiku-20241022",  provider: "anthropic", label: "Claude 3.5 Haiku",  supportsTools: true, supportsVision: true },
];

// Export for LlmService to use when listing without a provider instance
export const ANTHROPIC_MODELS = FALLBACK_MODELS;

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic";
  constructor(private readonly apiKey: string) {}

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  /** Fetch available models live from the Anthropic API. */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return FALLBACK_MODELS;
      const data = await res.json() as { data?: { id: string; display_name?: string }[] };
      const models = (data.data ?? [])
        .filter(m => m.id.startsWith("claude"))
        .map(m => ({
          id: `anthropic:${m.id}`,
          provider: "anthropic",
          label: m.display_name ?? m.id,
          supportsTools: true,
          supportsVision: !m.id.startsWith("claude-2"), // claude-3 and later all support vision
        }));
      return models.length ? models : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async *streamChat(opts: ChatOptions): AsyncIterable<string> {
    const modelId = opts.model.replace(/^anthropic:/, "");
    const system = opts.messages.find((m) => m.role === "system")?.content ?? "";

    // Build Anthropic messages; use content-block format when image is present
    const messages = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.imageData && m.imageMime) {
          return {
            role: m.role,
            content: [
              { type: "image", source: { type: "base64", media_type: m.imageMime, data: m.imageData } },
              { type: "text", text: m.content },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: modelId, max_tokens: 8192, system, messages, stream: true }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${detail}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const obj = JSON.parse(line.slice(5).trim());
          if (obj.type === "content_block_delta") {
            const token: string | undefined = obj?.delta?.text;
            if (token) yield token;
          }
          if (obj.type === "message_stop") return;
        } catch { /* skip */ }
      }
    }
  }
}
