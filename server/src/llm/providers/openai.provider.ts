import type { ChatOptions, ChatProvider, ModelInfo } from "../provider.types";

const FALLBACK_MODELS: ModelInfo[] = [
  { id: "openai:gpt-4o",      provider: "openai", label: "GPT-4o",      supportsTools: true,  supportsVision: true  },
  { id: "openai:gpt-4o-mini", provider: "openai", label: "GPT-4o mini", supportsTools: true,  supportsVision: true  },
  { id: "openai:o1-mini",     provider: "openai", label: "o1 mini",     supportsTools: false, supportsVision: false },
  { id: "openai:o3-mini",     provider: "openai", label: "o3 mini",     supportsTools: true,  supportsVision: false },
];

export const OPENAI_MODELS = FALLBACK_MODELS;

// Only surface chat-capable models (skip embeddings, tts, whisper, etc.)
const CHAT_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3", "chatgpt"];

export class OpenAIProvider implements ChatProvider {
  readonly id = "openai";
  constructor(private readonly apiKey: string) {}

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return FALLBACK_MODELS;
      const data = await res.json() as { data?: { id: string }[] };
      const models = (data.data ?? [])
        .filter(m => CHAT_PREFIXES.some(p => m.id.startsWith(p)))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(m => ({
          id: `openai:${m.id}`,
          provider: "openai",
          label: m.id,
          supportsTools: !m.id.startsWith("o1"),
          supportsVision: m.id.startsWith("gpt-4o") || m.id.startsWith("gpt-4-turbo") || m.id.includes("vision"),
        }));
      return models.length ? models : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async *streamChat(opts: ChatOptions): AsyncIterable<string> {
    const modelId = opts.model.replace(/^openai:/, "");

    // Build messages; inject image as content array when present
    const messages = opts.messages.map((m) => {
      if (m.imageData && m.imageMime) {
        return {
          role: m.role,
          content: [
            { type: "image_url", image_url: { url: `data:${m.imageMime};base64,${m.imageData}` } },
            { type: "text", text: m.content },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: modelId, messages, stream: true }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI API error ${res.status}: ${detail}`);
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
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const obj = JSON.parse(data);
          const token: string | undefined = obj?.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* skip */ }
      }
    }
  }
}
