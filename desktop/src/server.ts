import { ChildProcess, spawn, execSync } from "node:child_process";
import { join } from "node:path";
import * as http from "node:http";
import { app } from "electron";

export const SERVER_PORT = 1616;
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

let serverProcess: ChildProcess | null = null;
let _log: (...a: unknown[]) => void = console.log;

/** Inject the main-process logger so server output goes to app.log. */
export function setLogger(fn: (...a: unknown[]) => void): void {
  _log = fn;
}

function serverEntryPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "server", "bundle", "index.js");
  }
  return join(__dirname, "..", "..", "server", "dist", "main.js");
}

function webDistPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "web", "dist");
  }
  return join(__dirname, "..", "..", "web", "dist");
}

function nodeBinary(): string {
  if (app.isPackaged) return process.execPath;
  try {
    const cmd = process.platform === "win32" ? "where node" : "which node";
    const found = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0].trim();
    if (found) return found;
  } catch {}
  return "node";
}

export function startServer(): void {
  const entry = serverEntryPath();
  const nodePath = nodeBinary();
  _log(`[server] binary: ${nodePath}`);
  _log(`[server] entry:  ${entry}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ENZO_PORT: String(SERVER_PORT),
    ENZO_WEB_DIR: webDistPath(),
    ENZO_DATA_DIR: app.getPath("userData"),
    NODE_ENV: app.isPackaged ? "production" : (process.env.NODE_ENV ?? "development"),
  };

  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = "1";

  _log(`[server] env: PORT=${env.ENZO_PORT} DATA=${env.ENZO_DATA_DIR}`);

  serverProcess = spawn(nodePath, [entry], { stdio: "pipe", env });

  // Pipe server output into our log file so crashes are visible.
  serverProcess.stdout?.on("data", (d: Buffer) => _log("[server-out]", d.toString().trim()));
  serverProcess.stderr?.on("data", (d: Buffer) => _log("[server-err]", d.toString().trim()));

  serverProcess.on("exit", (code, signal) => {
    _log(`[server] exited — code=${code} signal=${signal}`);
    serverProcess = null;
  });
  serverProcess.on("error", (err) => {
    _log(`[server] spawn error: ${err.message}`);
  });
}

/**
 * Poll the server health endpoint using Node's http module (not fetch).
 * fetch() in the Electron main process routes through Chromium's network
 * stack which silently fails for localhost in packaged apps.
 */
function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: SERVER_PORT, path: "/api/health", timeout: 2000 },
      (res) => { resolve(res.statusCode === 200); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

export async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    if (await checkHealth()) {
      _log(`[server] health OK after ${attempts} attempts`);
      return;
    }
    if (attempts % 5 === 0) _log(`[server] waiting… attempt ${attempts}`);
    attempts++;
    await sleep(500);
  }
  throw new Error(`Server did not start within ${timeoutMs / 1000}s`);
}

export function stopServer(): void {
  if (serverProcess && !serverProcess.killed) {
    _log("[server] stopping…");
    serverProcess.kill();
    serverProcess = null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
