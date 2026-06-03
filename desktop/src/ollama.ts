import { ChildProcess, spawn, execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, chmodSync } from "node:fs";
import { app } from "electron";

const OLLAMA_PORT = 11434;
const OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`;

let ollamaProcess: ChildProcess | null = null;

/**
 * Returns the path to the bundled Ollama binary inside the app package.
 * In dev mode falls back to the system PATH.
 */
function bundledOllamaPath(): string | null {
  if (!app.isPackaged) return null;
  const ext = process.platform === "win32" ? ".exe" : "";
  const binary = `ollama${ext}`;
  const bundled = join(process.resourcesPath, "ollama", binary);
  return existsSync(bundled) ? bundled : null;
}

/** Find the Ollama binary: bundled → system PATH → null */
function findOllama(): string | null {
  const bundled = bundledOllamaPath();
  if (bundled) return bundled;
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const path = execSync(`${which} ollama`, { encoding: "utf-8" }).trim().split("\n")[0];
    if (path) return path;
  } catch {
    // not on PATH
  }
  return null;
}

/** Is Ollama's HTTP API already responding? */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure Ollama is running. If it's already up (e.g. user has it installed
 * as a background service), we do nothing. Otherwise we start our bundled
 * or system copy and manage its lifecycle.
 */
export async function ensureOllama(): Promise<void> {
  if (await isOllamaRunning()) {
    console.log("[ollama] already running");
    return;
  }

  const ollamaPath = findOllama();
  if (!ollamaPath) {
    throw new Error(
      "Ollama not found. Please install Ollama from https://ollama.com or use the bundled version.",
    );
  }

  // Make the binary executable on Unix
  if (process.platform !== "win32") {
    try { chmodSync(ollamaPath, 0o755); } catch {}
  }

  console.log(`[ollama] starting from ${ollamaPath}`);
  ollamaProcess = spawn(ollamaPath, ["serve"], {
    detached: false,
    stdio: "pipe",
    env: { ...process.env, OLLAMA_HOST: "127.0.0.1" },
  });

  ollamaProcess.stdout?.on("data", (d) => process.stdout.write(`[ollama] ${d}`));
  ollamaProcess.stderr?.on("data", (d) => process.stderr.write(`[ollama] ${d}`));
  ollamaProcess.on("exit", (code) => console.log(`[ollama] exited with code ${code}`));

  // Wait up to 15 s for Ollama to be ready
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await isOllamaRunning()) {
      console.log("[ollama] ready");
      return;
    }
  }
  throw new Error("Ollama started but did not become ready in time");
}

/** Pull a default model on first run if nothing is installed. */
export async function ensureDefaultModel(model = "llama3.2:3b"): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = (await res.json()) as { models?: { name: string }[] };
    if ((data.models ?? []).length > 0) return; // already has models
    console.log(`[ollama] pulling default model ${model}…`);
    await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false }),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 min timeout
    });
    console.log(`[ollama] ${model} ready`);
  } catch (err) {
    console.warn(`[ollama] could not pull default model: ${err}`);
  }
}

export function stopOllama(): void {
  if (ollamaProcess && !ollamaProcess.killed) {
    console.log("[ollama] stopping…");
    ollamaProcess.kill();
    ollamaProcess = null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
