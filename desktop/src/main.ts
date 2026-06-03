import { app, Menu, nativeImage, shell, Tray } from "electron";
import { join } from "node:path";
import { ensureDefaultModel, ensureOllama, stopOllama } from "./ollama";
import {
  SERVER_URL,
  startServer,
  stopServer,
  waitForServer,
} from "./server";

// Single instance guard — if another enzo is already running, focus it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray: Tray | null = null;
let ready = false;

// ── Tray icon ─────────────────────────────────────────────────────────────

function iconPath(name: string): string {
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
    { label: "Open Enzo", click: openBrowser, enabled: status === "ready" },
    { type: "separator" },
    { label: statusLabel, enabled: false },
    { type: "separator" },
    {
      label: "Quit Enzo",
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
  tray.setToolTip("Enzo — Local AI");
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
    tray?.setToolTip("Enzo — Running on " + SERVER_URL);
  }
}

// ── Browser ───────────────────────────────────────────────────────────────

function openBrowser(): void {
  shell.openExternal(SERVER_URL);
}

// ── Startup sequence ──────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    console.log("[enzo] starting services…");

    // 1. Start Ollama (bundled or system)
    await ensureOllama();

    // 2. Fork the NestJS server
    startServer();
    await waitForServer();

    ready = true;
    setStatus("ready");
    console.log(`[enzo] ready at ${SERVER_URL}`);

    // 3. Open browser on first launch
    if (!app.isPackaged || isFirstLaunch()) {
      openBrowser();
    }

    // 4. Pull the default model in the background if nothing is installed
    ensureDefaultModel().catch(() => {});
  } catch (err) {
    console.error("[enzo] startup failed:", err);
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
  console.log("[enzo] shutting down…");
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
