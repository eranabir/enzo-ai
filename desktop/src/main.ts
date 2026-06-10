import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { ensureOllama, stopOllama } from "./ollama";
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

  // Clicking the tray shows the menu (with "Open Enzo AI"), never the browser
  // directly. macOS pops the context menu automatically when one is set; on
  // Windows/Linux a left-click needs us to show it explicitly.
  tray.on("click", () => {
    if (process.platform !== "darwin") tray?.popUpContextMenu();
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

    // 3. Open browser automatically after server is ready. The first model is
    //    chosen and downloaded by the user in the web setup wizard (which can
    //    analyze the machine and recommend a fitting model), so we no longer
    //    auto-pull a default here.
    openBrowser();
  } catch (err) {
    log("[enzo-ai] startup FAILED:", (err as Error).stack || String(err));
    setStatus("error");
  }
}

// ── Setup window ─────────────────────────────────────────────────────────────

const SETUP_DONE_FILE = () => join(app.getPath("userData"), "setup-done");
const isSetupDone = () => existsSync(SETUP_DONE_FILE());
const markSetupDone = () => {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(SETUP_DONE_FILE(), "1");
};

async function installCli(): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    if (process.platform === "win32") {
      const installDir = join(process.execPath, "..");
      const { execSync } = require("node:child_process");
      execSync(`reg add "HKCU\\Environment" /v PATH /t REG_EXPAND_SZ /d "%PATH%;${installDir}" /f`, { stdio: "ignore" });
      return { ok: true, path: join(installDir, "enzo-ai.cmd") };
    } else {
      const { mkdirSync: mkdir, copyFileSync, chmodSync } = require("node:fs");
      const src = app.isPackaged ? join(process.resourcesPath, "..", "enzo-ai") : join(__dirname, "..", "cli-wrappers", "enzo-ai");
      const dest = join(app.getPath("home"), ".local", "bin", "enzo-ai");
      mkdir(join(app.getPath("home"), ".local", "bin"), { recursive: true });
      copyFileSync(src, dest);
      chmodSync(dest, 0o755);
      return { ok: true, path: dest };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function openSetupWindow(): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      // useContentSize so these are the web-content dimensions (excluding the
      // title bar), and enough height that the CLI option + button never clip.
      useContentSize: true,
      width: 500,
      height: 620,
      resizable: false,
      title: "Enzo AI Setup",
      webPreferences: {
        preload: join(__dirname, "setup-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // setup.html ships inside the asar (listed under `files:` in
    // electron-builder.yml), so resolve it relative to __dirname (dist/) — the
    // same way the preload script is loaded. process.resourcesPath would point
    // outside the asar, where the file doesn't exist.
    const setupHtml = join(__dirname, "..", "src", "setup.html");
    win.loadFile(setupHtml);

    ipcMain.handleOnce("setup:install-cli", () => installCli());
    ipcMain.handleOnce("setup:complete", () => { markSetupDone(); win.close(); });
    win.on("closed", () => resolve());
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.on("ready", async () => {
  if (process.platform === "darwin") app.dock.hide();

  createTray();

  if (!isSetupDone()) await openSetupWindow();

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

