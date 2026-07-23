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
    // name-based heuristic). One /api/show call per model derives all caps.
    return Promise.all(
      models.map(async (m) => {
        const caps = await this.capabilities(m.name);
        return {
          id: m.name,
          provider: this.id,
          label: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined,
          supportsTools: caps.tools,
          supportsVision: caps.vision,
          supportsChat: caps.chat,
        };
      }),
    );
  }

  /**
   * Derive a model's tool / vision / chat capabilities from a single /api/show
   * call. `completion` (text generation) marks a chat model; embedding-only
   * models (e.g. nomic-embed-text) report only `embedding` and so are not chat.
   */
  private async capabilities(modelName: string): Promise<{ tools: boolean; vision: boolean; chat: boolean }> {
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
          const caps = info.capabilities;
          return {
            tools: caps.includes("tools"),
            vision: caps.includes("vision"),
            chat: caps.includes("completion") || caps.includes("insert"),
          };
        }
      }
    } catch { /* fall through to name-based heuristics */ }
    const lower = modelName.toLowerCase();
    return {
      tools: ["llama3.1", "llama3.2", "qwen2", "qwen2.5", "qwen3", "mistral", "mixtral",
              "command-r", "firefunction"].some((m) => lower.includes(m)) && !lower.includes("embed"),
      vision: ["llava", "llava-llama", "bakllava", "moondream", "minicpm-v",
               "llama3.2-vision", "qwen2-vl", "gemma3"].some((m) => lower.includes(m)),
      chat: !lower.includes("embed"),
    };
  }

  /** Whether a model is already pulled locally. */
  async hasModel(model: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      const base = model.replace(/^ollama:/, "");
      return models.some((m) => m.id === base || m.id === `${base}:latest` || m.id.split(":")[0] === base.split(":")[0]);
    } catch {
      return false;
    }
  }

  /** Embed one or more texts with an embedding model (e.g. nomic-embed-text). */
  async embed(model: string, input: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: model.replace(/^ollama:/, ""), input }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama /api/embed failed: ${res.status} ${detail}`);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings?.length) throw new Error("Ollama returned no embeddings");
    return data.embeddings;
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
      // num_ctx caps the context window Ollama allocates for this model. Left
      // unset, Ollama defaults to the model's own max (often 32K–128K on newer
      // models), which can force part of the model off the GPU onto much-slower
      // CPU inference to fit the resulting KV cache — measured 3x+ slower on a
      // 16GB-VRAM card with a 24B model at its native 65K context vs capped at
      // 8192. 8192 comfortably covers a chat + a handful of retrieved KB chunks;
      // very long-running conversations will have their oldest turns fall out
      // of context first rather than erroring.
      // temperature lowered from Ollama's default (~0.7-0.8): with RAG-retrieved
      // context in the prompt, a high temperature makes the model more prone to
      // inventing plausible-sounding but false details instead of sticking to
      // the provided source text — observed directly (same question, same
      // context, correct answer on one run and a fabricated one on another).
      body: JSON.stringify({ model: opts.model, messages, stream: true, keep_alive: -1, options: { num_ctx: opts.numCtx ?? 8192, temperature: 0.2 } }),
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
