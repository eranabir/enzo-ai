/**
 * Release smoke test: proves a *packaged* build can actually hold a
 * conversation, not just start up.
 *
 * This exists because of a real incident: the Windows Ollama download only
 * kept `ollama.exe` and discarded `lib/ollama/` (the actual inference
 * engines), so every Windows build could list models but crashed as soon as
 * you sent a message. `yarn build` / `tsc` didn't catch it — the daemon
 * boots and answers `/api/tags` fine; only running an actual model exposes
 * the missing `llama-server` binary. So this script builds the same
 * artifacts a release ships (server/dist/bundle + desktop/resources/ollama),
 * spawns them exactly like the desktop app does, pulls a small model, and
 * sends one real chat message end to end over SSE.
 *
 * Usage: npx tsx scripts/smoke-test.ts
 * Env:   SMOKE_MODEL (default qwen2.5:0.5b)
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const MODEL = process.env.SMOKE_MODEL ?? "qwen2.5:0.5b";

const OLLAMA_PORT = 11500;
const OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`;
const ENZO_PORT = 17167;
const ENZO_URL = `http://127.0.0.1:${ENZO_PORT}`;

const procs: ChildProcess[] = [];
const tail = new Map<ChildProcess, string[]>();

function track(p: ChildProcess, name: string): void {
  procs.push(p);
  const lines: string[] = [];
  tail.set(p, lines);
  const capture = (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (!line.trim()) continue;
      lines.push(`[${name}] ${line}`);
      if (lines.length > 200) lines.shift();
    }
  };
  p.stdout?.on("data", capture);
  p.stderr?.on("data", capture);
}

function dumpLogs(): void {
  for (const p of procs) {
    console.error(`\n--- last output from pid ${p.pid} ---`);
    console.error((tail.get(p) ?? []).join("\n"));
  }
}

function killAll(): void {
  for (const p of procs) {
    if (!p.killed) p.kill();
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function pullModel(): Promise<void> {
  console.log(`[smoke] pulling ${MODEL} ...`);
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`pull failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastStatus = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line);
      if (obj.status && obj.status !== lastStatus) {
        lastStatus = obj.status;
        console.log(`[smoke]   ${obj.status}`);
      }
      if (obj.error) throw new Error(`pull error: ${obj.error}`);
    }
  }
  console.log(`[smoke] ${MODEL} pulled`);
}

async function sendChatMessage(token: string, chatId: string): Promise<void> {
  const res = await fetch(`${ENZO_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-enzo-ai-token": token },
    body: JSON.stringify({ chatId, content: "Say hello in exactly 3 words." }),
  });
  if (!res.ok || !res.body) throw new Error(`/api/chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let tokenCount = 0;
  let sawDone = false;
  let sawError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 2);
      if (!chunk.startsWith("data:")) continue;
      const payload = JSON.parse(chunk.slice(5).trim());
      if (payload.error) sawError = payload.error;
      if (typeof payload.token === "string") tokenCount++;
      if (payload.done) sawDone = true;
    }
  }

  if (sawError) throw new Error(`model returned an error instead of a reply: ${sawError}`);
  if (!sawDone) throw new Error("stream never reached done:true");
  if (tokenCount === 0) throw new Error("no tokens were streamed back — model produced no output");
  console.log(`[smoke] received ${tokenCount} tokens, stream completed cleanly`);
}

async function main(): Promise<void> {
  const ollamaBin = join(
    ROOT, "desktop", "resources", "ollama",
    process.platform === "win32" ? "ollama.exe" : "ollama",
  );
  const serverBundle = join(ROOT, "server", "dist", "bundle", "index.js");
  if (!existsSync(ollamaBin)) throw new Error(`bundled ollama binary missing: ${ollamaBin} (run 'yarn download:ollama')`);
  if (!existsSync(serverBundle)) throw new Error(`server bundle missing: ${serverBundle} (run 'yarn build:server')`);

  const ollamaModels = mkdtempSync(join(tmpdir(), "enzo-smoke-ollama-"));
  const enzoData = mkdtempSync(join(tmpdir(), "enzo-smoke-data-"));

  try {
    console.log(`[smoke] starting bundled ollama from ${ollamaBin}`);
    const ollama = spawn(ollamaBin, ["serve"], {
      env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`, OLLAMA_MODELS: ollamaModels },
    });
    track(ollama, "ollama");
    await waitForHttp(`${OLLAMA_URL}/api/tags`, 20_000);
    console.log("[smoke] ollama daemon ready");

    await pullModel();

    console.log(`[smoke] starting server bundle on port ${ENZO_PORT}`);
    const server = spawn(process.execPath, [serverBundle], {
      env: {
        ...process.env,
        ENZO_PORT: String(ENZO_PORT),
        ENZO_HOST: "127.0.0.1",
        ENZO_DATA_DIR: enzoData,
        OLLAMA_URL,
      },
    });
    track(server, "server");
    // /api/system requires auth; /api/auth/profiles doesn't, so it's a safe
    // unauthenticated readiness probe.
    await waitForHttp(`${ENZO_URL}/api/auth/profiles`, 20_000);
    console.log("[smoke] server ready");

    const registerRes = await fetch(`${ENZO_URL}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "smoketest", password: "smoketest-pw" }),
    });
    if (!registerRes.ok) throw new Error(`register failed: ${registerRes.status}`);
    const { token } = (await registerRes.json()) as { token: string };

    const chatRes = await fetch(`${ENZO_URL}/api/chats`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-enzo-ai-token": token },
      body: JSON.stringify({ model: MODEL }),
    });
    if (!chatRes.ok) throw new Error(`create chat failed: ${chatRes.status}`);
    const { id: chatId } = (await chatRes.json()) as { id: string };

    console.log("[smoke] sending a real chat message...");
    await sendChatMessage(token, chatId);

    console.log("\n✅ smoke test passed — the packaged build can actually chat with a model.");
  } catch (err) {
    console.error(`\n❌ smoke test failed: ${(err as Error).message}`);
    dumpLogs();
    process.exitCode = 1;
  } finally {
    killAll();
    rmSync(ollamaModels, { recursive: true, force: true });
    rmSync(enzoData, { recursive: true, force: true });
  }
}

main();
