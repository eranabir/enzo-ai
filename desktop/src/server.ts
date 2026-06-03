import { ChildProcess, spawn, execSync } from "node:child_process";
import { join } from "node:path";
import { app } from "electron";

export const SERVER_PORT = 6666;  // production port (Electron-managed)
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

let serverProcess: ChildProcess | null = null;

/** Absolute path to the server entry point.
 *  Production: ncc-bundled single file (all deps included except native).
 *  Dev: standard nest build output (node_modules resolved from workspace root).
 */
function serverEntryPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "server", "bundle", "index.js");
  }
  return join(__dirname, "..", "..", "server", "dist", "main.js");
}

/** Directory containing the built web assets (served by NestJS). */
function webDistPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "web", "dist");
  }
  return join(__dirname, "..", "..", "web", "dist");
}

/**
 * Find the Node.js binary to use for spawning the server.
 *
 * In production (packaged): use ELECTRON_RUN_AS_NODE=1 with process.execPath
 * so Electron's bundled node runs the server (modules were rebuilt for it).
 *
 * In development: use the SYSTEM node binary to avoid ABI mismatch —
 * better-sqlite3 was compiled for system Node, not Electron's Node.
 */
function nodeBinary(): string {
  if (app.isPackaged) return process.execPath;
  // Find system node
  try {
    const cmd = process.platform === "win32" ? "where node" : "which node";
    const found = execSync(cmd, { encoding: "utf-8" })
      .trim()
      .split("\n")[0]
      .trim();
    if (found) return found;
  } catch {}
  return "node";
}

export function startServer(): void {
  const entry = serverEntryPath();
  const nodePath = nodeBinary();
  console.log(`[server] starting: ${nodePath} ${entry}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ENZO_PORT: String(SERVER_PORT),
    ENZO_WEB_DIR: webDistPath(),
    // Store user data (SQLite, memory) in the OS user-data dir, not inside
    // the app package which is read-only on Windows (Program Files).
    ENZO_DATA_DIR: app.getPath("userData"),
    NODE_ENV: app.isPackaged ? "production" : (process.env.NODE_ENV ?? "development"),
  };

  // In production, ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave
  // as plain Node.js so our CJS server runs correctly.
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = "1";

  serverProcess = spawn(nodePath, [entry], {
    stdio: "pipe",
    env,
  });

  serverProcess.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[server] ${d}`),
  );
  serverProcess.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[server] ${d}`),
  );
  serverProcess.on("exit", (code, signal) => {
    console.log(`[server] exited code=${code} signal=${signal}`);
    serverProcess = null;
  });
  serverProcess.on("error", (err) => {
    console.error("[server] spawn error:", err.message);
  });
}

export async function waitForServer(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Server did not start within ${timeoutMs / 1000}s`);
}

export function stopServer(): void {
  if (serverProcess && !serverProcess.killed) {
    console.log("[server] stopping…");
    serverProcess.kill();
    serverProcess = null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
