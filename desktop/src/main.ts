import { app, Menu, nativeImage, shell, Tray } from "electron";
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { ensureDefaultModel, ensureOllama, stopOllama } from "./ollama";
import {
  SERVER_URL,
  setLogger,
  startServer,
  stopServer,
  waitForServer,
} from "./server";

// Set the app name before anything uses app.getPath() so userData is
// stored as %APPDATA%\Enzo AI\ (not the scoped package name).
app.setName("Enzo AI");

/** Write timestamped log to %APPDATA%\Enzo AI\app.log — visible even in prod. */
function log(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`;
  process.stdout.write(line);
  try {
    const logDir = app.getPath("userData");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "app.log"), line);
  } catch { /* ignore log write failures */ }
}

// Wire our logger into the server module so server crashes appear in app.log.
setLogger((...args) => log(...args));

// Single instance guard — if another enzo-ai is already running, focus it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray: Tray | null = null;
let ready = false;

// ── Tray icon ─────────────────────────────────────────────────────────────

function iconPath(name: string): string {
  // In dev: desktop/assets/  In production: resources/assets/ (via extraFiles)
  const base = app.isPackaged
    ? join(process.resourcesPath, "assets")
    : join(__dirname, "..", "assets");
  return join(base, name);
}

function buildMenu(status: "starting" | "ready" | "error") {
  const statusLabel =
    status === "ready"
      ? "● Running"
      : status === "error"
        ? "⚠ Error — check logs"
        : "○ Starting…";

  return Menu.buildFromTemplate([
    { label: "Open Enzo AI", click: openBrowser, enabled: status === "ready" },
    { type: "separator" },
    { label: statusLabel, enabled: false },
    { type: "separator" },
    {
      label: "Open Logs",
      click: () => {
        const logFile = join(app.getPath("userData"), "app.log");
        shell.openPath(logFile);
      },
    },
    { type: "separator" },
    {
      label: "Quit Enzo AI",
      click: () => {
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  // Template image (macOS: auto-inverts for dark/light menu bar)
  const imgName =
    process.platform === "darwin"
      ? "trayTemplate.png"
      : process.platform === "win32"
        ? "tray.ico"
        : "tray.png";

  let img: Electron.NativeImage;
  try {
    img = nativeImage.createFromPath(iconPath(imgName));
  } catch {
    img = nativeImage.createEmpty();
  }

  tray = new Tray(img);
  tray.setToolTip("Enzo AI");
  tray.setContextMenu(buildMenu("starting"));

  // Left-click on macOS / Linux opens browser; on Windows right-click shows menu
  tray.on("click", () => {
    if (ready) openBrowser();
    else tray?.popUpContextMenu();
  });
}

function setStatus(status: "starting" | "ready" | "error"): void {
  tray?.setContextMenu(buildMenu(status));
  if (status === "ready") {
    tray?.setToolTip("Enzo AI —" + SERVER_URL);
  }
}

// ── Browser ───────────────────────────────────────────────────────────────

function openBrowser(): void {
  shell.openExternal(SERVER_URL);
}

// ── Startup sequence ──────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    log("[enzo-ai] starting — version", app.getVersion(), "packaged:", app.isPackaged);

    // 1. Start Ollama (bundled or system)
    log("[enzo-ai] ensuring Ollama…");
    await ensureOllama();
    log("[enzo-ai] Ollama ready");

    // 2. Fork the NestJS server
    log("[enzo-ai] starting server…");
    startServer();
    log("[enzo-ai] waiting for server on", SERVER_URL);
    await waitForServer();
    log("[enzo-ai] server ready");

    ready = true;
    setStatus("ready");
    log(`[enzo-ai] ready at ${SERVER_URL}`);

    // 3. Open browser on first launch
    if (!app.isPackaged || isFirstLaunch()) {
      log("[enzo-ai] opening browser");
      openBrowser();
    }

    // 4. Pull the default model in the background if nothing is installed
    ensureDefaultModel().catch((e) => log("[enzo-ai] model pull failed:", e.message));
  } catch (err) {
    log("[enzo-ai] startup FAILED:", (err as Error).stack || String(err));
    setStatus("error");
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.on("ready", async () => {
  // Hide from macOS dock — enzo lives in the menu bar only
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  createTray();
  await start();
});

// Keep the app alive when all windows are closed (it's a tray app)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // On non-mac, prevent the default quit — we want to stay in the tray
  }
});

app.on("before-quit", () => {
  console.log("[enzo-ai] shutting down…");
  stopServer();
  stopOllama();
});

app.on("second-instance", () => {
  // Someone tried to run a second instance — open browser instead
  if (ready) openBrowser();
});

// ── Helpers ───────────────────────────────────────────────────────────────

const FIRST_LAUNCH_KEY = "firstLaunchDone";

function isFirstLaunch(): boolean {
  const done = app.isPackaged
    ? (global as unknown as Record<string, unknown>)[FIRST_LAUNCH_KEY]
    : true;
  if (!done) {
    (global as unknown as Record<string, unknown>)[FIRST_LAUNCH_KEY] = true;
    return true;
  }
  return false;
}
