import { Injectable } from "@nestjs/common";
import { config } from "../config";
import type { ChatOptions, ChatProvider, ModelInfo } from "./provider.types";

/**
 * Local Ollama provider. Talks to the Ollama daemon over its native HTTP API.
 * Ollama is installed/managed as a dependency of Enzo AI.
 */
@Injectable()
export class OllamaProvider implements ChatProvider {
  readonly id = "ollama";
  private readonly baseUrl = config.ollamaUrl;

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`);
    const data = (await res.json()) as {
      models?: { name: string; size?: number }[];
    };
    const models = data.models ?? [];

    // Fetch capabilities for each model in parallel (Ollama v0.3+ returns a
    // `capabilities` array from /api/show; older versions fall back to a
    // name-based heuristic).
    return Promise.all(
      models.map(async (m) => ({
        id: m.name,
        provider: this.id,
        label: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined,
        supportsTools: await this.checkToolSupport(m.name),
        supportsVision: await this.checkVisionSupport(m.name),
      })),
    );
  }

  /** Ask Ollama whether this model supports tool/function calling. */
  private async checkToolSupport(modelName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const info = (await res.json()) as { capabilities?: string[] };
        if (Array.isArray(info.capabilities)) {
          return info.capabilities.includes("tools");
        }
      }
    } catch { /* fall through */ }
    // Older Ollama without capabilities field — use known model families
    return this.nameBasedToolsGuess(modelName);
  }

  private nameBasedToolsGuess(name: string): boolean {
    const lower = name.toLowerCase();
    return ["llama3.1", "llama3.2", "qwen2", "mistral", "mixtral",
            "command-r", "firefunction"].some(m => lower.includes(m));
  }

  private async checkVisionSupport(modelName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const info = (await res.json()) as { capabilities?: string[] };
        if (Array.isArray(info.capabilities)) {
          return info.capabilities.includes("vision");
        }
      }
    } catch { /* fall through */ }
    // Name-based fallback for known vision models
    const lower = modelName.toLowerCase();
    return ["llava", "llava-llama", "bakllava", "moondream", "minicpm-v",
            "llama3.2-vision", "qwen2-vl", "gemma3"].some(m => lower.includes(m));
  }

  /** Pull a model, yielding human-readable progress lines (NDJSON stream). */
  async *pullModel(
    model: string,
  ): AsyncIterable<{ status: string; completed?: number; total?: number }> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/pull failed: ${res.status}`);
    }
    for await (const obj of parseNdjson(res.body)) {
      if (typeof obj.status === "string") {
        yield {
          status: obj.status,
          completed: typeof obj.completed === "number" ? obj.completed : undefined,
          total: typeof obj.total === "number" ? obj.total : undefined,
        };
      }
    }
  }

  async *streamChat(opts: ChatOptions): AsyncIterable<string> {
    // Ollama expects images as a plain base64 string array alongside the message
    const messages = opts.messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.imageData) msg.images = [m.imageData];
      return msg;
    });

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama /api/chat failed: ${res.status} ${detail}`);
    }

    for await (const obj of parseNdjson(res.body)) {
      const token = obj?.message?.content;
      if (typeof token === "string" && token.length) yield token;
      if (obj?.done) return;
    }
  }
}

/** Parse a streaming NDJSON body into objects. */
async function* parseNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line);
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail);
  } finally {
    reader.releaseLock();
  }
}
