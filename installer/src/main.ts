import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";
import { createWriteStream, existsSync, mkdirSync, chmodSync, writeFileSync } from "fs";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as https from "https";
import * as http from "http";
import * as os from "os";

const execAsync = promisify(exec);

// ── Window ───────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 620,
    resizable: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "../src/renderer/index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

// ── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const VERSION: string = (require("../package.json") as { version: string }).version;
const REPO = "eranabir/enzo-ai";

function getPlatform(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function getArch(): "x64" | "arm64" {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function assetUrl(filename: string): string {
  return `https://github.com/${REPO}/releases/download/v${VERSION}/${filename}`;
}

function downloadFile(
  url: string,
  dest: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location!, dest, onProgress)
          .then(resolve)
          .catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers["content-length"] ?? "0", 10);
      let received = 0;
      const file = createWriteStream(dest);
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) onProgress(Math.round((received / total) * 100));
      });
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}

const tmpDir = join(os.tmpdir(), "enzo-ai-install");

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle("get-platform-info", () => ({
  platform: getPlatform(),
  arch: getArch(),
  version: VERSION,
}));

type Components = { cli: boolean };

ipcMain.handle("install", async (_event, components: Components) => {
  const send = (msg: { step: string; progress?: number; error?: string; done?: boolean }) =>
    win?.webContents.send("install-progress", msg);

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const platform = getPlatform();
  const arch = getArch();

  try {
    // ── 1. Download + install the server (Electron tray app) ────────────────
    send({ step: "Downloading Enzo AI server…", progress: 0 });

    if (platform === "windows") {
      const file = `enzo-ai-windows-${VERSION}.exe`;
      const dest = join(tmpDir, file);
      await downloadFile(assetUrl(file), dest, (p) =>
        send({ step: "Downloading server…", progress: Math.round(p * 0.55) }),
      );
      send({ step: "Installing server…", progress: 57 });
      await execAsync(`"${dest}" /S`); // silent NSIS install

    } else if (platform === "macos") {
      const file = `enzo-ai-macos-${VERSION}-${arch}.dmg`;
      const dest = join(tmpDir, file);
      await downloadFile(assetUrl(file), dest, (p) =>
        send({ step: "Downloading server…", progress: Math.round(p * 0.55) }),
      );
      send({ step: "Installing server…", progress: 57 });
      const mp = `/Volumes/EnzoInstall-${Date.now()}`;
      await execAsync(`hdiutil attach "${dest}" -mountpoint "${mp}" -nobrowse -quiet`);
      await execAsync(`cp -R "${mp}/Enzo AI.app" /Applications/`);
      await execAsync(`hdiutil detach "${mp}" -quiet`);
      // Register as login item
      await execAsync(
        `osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Enzo AI.app", hidden:true}'`,
      ).catch(() => {});

    } else {
      // Linux — AppImage
      const file = `enzo-ai-linux-${VERSION}.AppImage`;
      const binDir = join(os.homedir(), ".local", "bin");
      const dest = join(binDir, "enzo-ai-server");
      mkdirSync(binDir, { recursive: true });
      await downloadFile(assetUrl(file), dest, (p) =>
        send({ step: "Downloading server…", progress: Math.round(p * 0.55) }),
      );
      chmodSync(dest, 0o755);
      // Autostart desktop entry
      const autostartDir = join(os.homedir(), ".config", "autostart");
      mkdirSync(autostartDir, { recursive: true });
      writeFileSync(
        join(autostartDir, "enzo-ai.desktop"),
        `[Desktop Entry]\nType=Application\nName=Enzo AI\nExec=${dest}\nHidden=false\nX-GNOME-Autostart-enabled=true\n`,
      );
    }

    send({ step: "Server installed ✓", progress: 60 });

    // ── 2. CLI (optional) ────────────────────────────────────────────────────
    if (components.cli) {
      send({ step: "Downloading CLI…", progress: 61 });

      if (platform === "windows") {
        const file = "enzo-ai-cli-windows-x64.exe";
        const installDir = `C:\\Program Files\\Enzo AI`;
        const dest = join(installDir, "enzo-ai.exe");
        mkdirSync(installDir, { recursive: true });
        await downloadFile(assetUrl(file), dest, (p) =>
          send({ step: "Downloading CLI…", progress: 61 + Math.round(p * 0.35) }),
        );
        // Add install dir to user PATH
        await execAsync(
          `reg add "HKCU\\Environment" /v PATH /t REG_EXPAND_SZ /d "%PATH%;${installDir}" /f`,
        ).catch(() => {});

      } else if (platform === "macos") {
        const file = `enzo-ai-cli-macos-${arch}`;
        const tmp = join(tmpDir, file);
        const dest = "/usr/local/bin/enzo-ai";
        await downloadFile(assetUrl(file), tmp, (p) =>
          send({ step: "Downloading CLI…", progress: 61 + Math.round(p * 0.35) }),
        );
        await execAsync(`cp "${tmp}" "${dest}" && chmod +x "${dest}"`);

      } else {
        const file = `enzo-ai-cli-linux-${arch}`;
        const dest = join(os.homedir(), ".local", "bin", "enzo-ai");
        await downloadFile(assetUrl(file), dest, (p) =>
          send({ step: "Downloading CLI…", progress: 61 + Math.round(p * 0.35) }),
        );
        chmodSync(dest, 0o755);
      }

      send({ step: "CLI installed ✓", progress: 97 });
    }

    // ── 3. Launch the server ────────────────────────────────────────────────
    send({ step: "Starting Enzo AI…", progress: 98 });
    if (platform === "windows") {
      spawn("cmd", ["/c", "start", "", "Enzo AI"], { detached: true, shell: true });
    } else if (platform === "macos") {
      spawn("open", ["-a", "Enzo AI"], { detached: true });
    } else {
      spawn(join(os.homedir(), ".local", "bin", "enzo-ai-server"), [], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }

    send({ step: "Installation complete!", progress: 100, done: true });

  } catch (err) {
    send({ step: "Installation failed", error: (err as Error).message });
  }
});

ipcMain.handle("open-browser", () => shell.openExternal("http://localhost:1616"));
ipcMain.handle("quit", () => app.quit());
