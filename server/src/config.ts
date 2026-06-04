import * as path from "node:path";

/**
 * Central config for the Enzo AI local engine.
 * Everything is local-first; values can be overridden by env vars so the
 * same code works in dev and inside a packaged desktop app later.
 */
export const config = {
  port: Number(process.env.ENZO_PORT ?? 1616),

  // Bind address — 127.0.0.1 for local-only (desktop), 0.0.0.0 for Docker/NAS
  host: process.env.ENZO_HOST ?? "127.0.0.1",

  dataDir: process.env.ENZO_DATA_DIR ?? path.resolve(__dirname, "../../data"),

  // Ollama — use OLLAMA_URL to point at a sidecar container in Docker
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",

  defaultModel: process.env.ENZO_DEFAULT_MODEL ?? "llama3.2:3b",
} as const;

export const dbPath = path.join(config.dataDir, "enzo-ai.sqlite");
