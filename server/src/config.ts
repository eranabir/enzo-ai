import * as path from "node:path";

/**
 * Central config for the Enzo local engine.
 * Everything is local-first; values can be overridden by env vars so the
 * same code works in dev and inside a packaged desktop app later.
 */
export const config = {
  port: Number(process.env.ENZO_PORT ?? 1616),  // dev default; Electron overrides to 6666

  // Where local data (conversations, memory) lives. A real file on disk so it
  // is portable and backup-able, unlike browser storage.
  dataDir: process.env.ENZO_DATA_DIR ?? path.resolve(__dirname, "../../data"),

  // Ollama runs locally as a managed dependency and exposes this API.
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",

  // The small, fast default model. Users can switch in the UI.
  defaultModel: process.env.ENZO_DEFAULT_MODEL ?? "llama3.2:3b",
} as const;

export const dbPath = path.join(config.dataDir, "enzo.sqlite");
