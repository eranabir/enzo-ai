import type { ChatOptions, ChatProvider, ModelInfo } from "../provider.types";

const FALLBACK_MODELS: ModelInfo[] = [
  { id: "google:gemini-2.0-flash",   provider: "google", label: "Gemini 2.0 Flash", supportsTools: true, supportsVision: true },
  { id: "google:gemini-1.5-pro",     provider: "google", label: "Gemini 1.5 Pro",   supportsTools: true, supportsVision: true },
  { id: "google:gemini-1.5-flash",   provider: "google", label: "Gemini 1.5 Flash", supportsTools: true, supportsVision: true },
];

export const GOOGLE_MODELS = FALLBACK_MODELS;

export class GeminiProvider implements ChatProvider {
  readonly id = "google";
  constructor(private readonly apiKey: string) {}

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return FALLBACK_MODELS;
      const data = await res.json() as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
      };
      const models = (data.models ?? [])
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .filter(m => !m.name.includes("embedding") && !m.name.includes("aqa"))
        .map(m => {
          const id = m.name.replace("models/", "");
          return {
            id: `google:${id}`,
            provider: "google",
            label: m.displayName ?? id,
            supportsTools: true,
            supportsVision: true, // all Gemini models support vision
          };
        });
      return models.length ? models : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async *streamChat(opts: ChatOptions): AsyncIterable<string> {
    const modelId = opts.model.replace(/^google:/, "");
    const system = opts.messages.find(m => m.role === "system")?.content;
    const contents = opts.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          ...(m.imageData && m.imageMime
            ? [{ inline_data: { mime_type: m.imageMime, data: m.imageData } }]
            : []),
          { text: m.content },
        ],
      }));

    const body: Record<string, unknown> = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini API error ${res.status}: ${detail}`);
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
          const token: string | undefined = obj?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) yield token;
        } catch { /* skip */ }
      }
    }
  }
}
