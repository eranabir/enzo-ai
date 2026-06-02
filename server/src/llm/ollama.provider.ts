import { Injectable } from "@nestjs/common";
import { config } from "../config";
import type { ChatOptions, ChatProvider, ModelInfo } from "./provider.types";

/**
 * Local Ollama provider. Talks to the Ollama daemon over its native HTTP API.
 * Ollama is installed/managed as a dependency of Enzo.
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
    return (data.models ?? []).map((m) => ({
      id: m.name,
      provider: this.id,
      label: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined,
    }));
  }

  /** Pull a model, yielding human-readable progress lines (NDJSON stream). */
  async *pullModel(model: string): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/pull failed: ${res.status}`);
    }
    for await (const obj of parseNdjson(res.body)) {
      if (typeof obj.status === "string") yield obj.status;
    }
  }

  async *streamChat(opts: ChatOptions): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
      }),
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
