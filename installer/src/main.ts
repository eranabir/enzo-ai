import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import * as https from "node:https";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync    = promisify(exec);

const REPO    = "eranabir/enzo-ai";
const VERSION = (require("../package.json") as { version: string }).version;

// ── Window ────────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: "Enzo AI Setup",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const ui = app.isPackaged
    ? join(process.resourcesPath, "src", "index.html")
    : join(__dirname, "..", "src", "index.html");

  win.loadFile(ui);
});

app.on("window-all-closed", () => app.quit());

// ── Helpers ───────────────────────────────────────────────────────────────────

function platformInfo() {
  const p = process.platform;
  const a = process.arch;
  return {
    platform: p === "win32" ? "windows" : p === "darwin" ? "macos" : "linux",
    arch: a === "arm64" ? "arm64" : "x64",
    version: VERSION,
  };
}

/** Asset URLs for this release on GitHub */
function assetUrl(filename: string) {
  return `https://github.com/${REPO}/releases/download/v${VERSION}/${filename}`;
}

function assetNames(platform: string, arch: string) {
  const v = VERSION;
  return {
    server: platform === "windows"
      ? `enzo-ai-windows-${v}.exe`
      : platform === "macos"
        ? `enzo-ai-macos-${v}-${arch}.dmg`
        : `enzo-ai-linux-amd64.deb`,
    cli: platform === "windows"
      ? `enzo-ai-cli-windows-x64.exe`
      : platform === "macos"
        ? `enzo-ai-cli-macos-${arch}`
        : `enzo-ai-cli-linux-${arch}`,
  };
}

/** Download a file with progress callback. Follows redirects. */
function download(url: string, dest: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location!, dest, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode} — ${url}`));
      }
      const total = parseInt(res.headers["content-length"] ?? "0", 10);
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) onProgress(Math.round((received / total) * 100));
      });
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve()));
      out.on("error", reject);
    }).on("error", reject);
  });
}

const tmp = join(os.tmpdir(), "enzo-ai-install");
fs.mkdirSync(tmp, { recursive: true });

// ── Install logic ─────────────────────────────────────────────────────────────

async function installServer(platform: string, arch: string, onProgress: (pct: number) => void): Promise<void> {
  const { server } = assetNames(platform, arch);
  const dest = join(tmp, server);

  onProgress(0);
  await download(assetUrl(server), dest, (p) => onProgress(Math.round(p * 0.9)));
  onProgress(90);

  if (platform === "windows") {
    // NSIS silent install
    await execFileAsync(dest, ["/S"]);

  } else if (platform === "macos") {
    // Mount DMG → copy app → unmount
    const mountPoint = `/Volumes/enzo-ai-${Date.now()}`;
    await execAsync(`hdiutil attach "${dest}" -mountpoint "${mountPoint}" -nobrowse -quiet`);
    try {
      await execAsync(`cp -R "${mountPoint}/Enzo AI.app" /Applications/`);
      // Enable login item on macOS
      await execAsync(`osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Enzo AI.app", hidden:true}'`).catch(() => {});
    } finally {
      await execAsync(`hdiutil detach "${mountPoint}" -quiet`).catch(() => {});
    }
  }

  onProgress(100);
}

async function installCli(platform: string, arch: string, onProgress: (pct: number) => void): Promise<void> {
  const { cli } = assetNames(platform, arch);
  const dest = join(tmp, cli);

  onProgress(0);
  await download(assetUrl(cli), dest, (p) => onProgress(Math.round(p * 0.8)));
  onProgress(80);

  if (platform === "windows") {
    const installDir = "C:\\Program Files\\Enzo AI";
    fs.mkdirSync(installDir, { recursive: true });
    fs.copyFileSync(dest, join(installDir, "enzo-ai.exe"));
    // Add to user PATH
    await execAsync(`reg add "HKCU\\Environment" /v PATH /t REG_EXPAND_SZ /d "%PATH%;${installDir}" /f`).catch(() => {});

  } else {
    const binDir = join(os.homedir(), ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "enzo-ai");
    fs.copyFileSync(dest, binPath);
    fs.chmodSync(binPath, 0o755);
  }

  onProgress(100);
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle("get-info", () => platformInfo());

ipcMain.handle("install", async (_event, components: { cli: boolean }) => {
  const { platform, arch } = platformInfo();

  const send = (step: string, progress: number, done = false, error?: string) =>
    win?.webContents.send("progress", { step, progress, done, error });

  try {
    // ── Always: install the server + web UI ──────────────────────────────────
    const cliShare = components.cli ? 0.6 : 0.9; // give CLI 30% of the bar if selected
    send("Downloading Enzo AI…", 0);
    await installServer(platform, arch, (p) => send("Downloading Enzo AI…", Math.round(p * cliShare)));
    send("Enzo AI installed ✓", Math.round(cliShare * 100));

    // ── Optional: CLI ─────────────────────────────────────────────────────────
    if (components.cli) {
      const base = Math.round(cliShare * 100);
      send("Downloading CLI…", base);
      await installCli(platform, arch, (p) => send("Downloading CLI…", base + Math.round(p * 0.37)));
      send("CLI installed ✓", 97);
    }

    // ── Launch ────────────────────────────────────────────────────────────────
    send("Launching Enzo AI…", 98);
    if (platform === "windows") {
      exec(`"C:\\Program Files\\Enzo AI\\Enzo AI.exe"`);
    } else if (platform === "macos") {
      exec("open -a 'Enzo AI'");
    }

    send("Done!", 100, true);

  } catch (err) {
    send("Installation failed", 0, false, (err as Error).message);
  }
});
