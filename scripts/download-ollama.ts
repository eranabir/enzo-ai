/**
 * Pre-build script: download and extract the Ollama binary for the current
 * (or target) platform into desktop/resources/ollama/.
 *
 * Usage:
 *   npx tsx scripts/download-ollama.ts                  # current platform
 *   OLLAMA_PLATFORM=win32 npx tsx scripts/download-ollama.ts
 */

import {
  createWriteStream,
  mkdirSync,
  existsSync,
  chmodSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLLAMA_VERSION = "v0.30.2";

const PLATFORM = (process.env.OLLAMA_PLATFORM ?? process.platform) as
  | "darwin"
  | "win32"
  | "linux";

const ARCH = (process.env.OLLAMA_ARCH ?? process.arch) as "x64" | "arm64";

const OUT_DIR = join(__dirname, "..", "desktop", "resources", "ollama");
const OUT_FILE = join(OUT_DIR, PLATFORM === "win32" ? "ollama.exe" : "ollama");

// Asset name → local archive filename
function assetInfo(): { url: string; archive: string } {
  const base = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}`;
  switch (PLATFORM) {
    case "win32":
      return {
        url: `${base}/ollama-windows-${ARCH === "arm64" ? "arm64" : "amd64"}.zip`,
        archive: "ollama-windows.zip",
      };
    case "darwin":
      return {
        url: `${base}/ollama-darwin.tgz`,
        archive: "ollama-darwin.tgz",
      };
    case "linux":
      return {
        url: `${base}/ollama-linux-${ARCH === "arm64" ? "arm64" : "amd64"}.tar.zst`,
        archive: "ollama-linux.tar.zst",
      };
    default:
      throw new Error(`Unsupported platform: ${PLATFORM}`);
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  let downloaded = 0;
  let lastPct = -1;

  const progress = new TransformStream({
    transform(chunk, ctrl) {
      downloaded += chunk.byteLength;
      const pct = total ? Math.floor((downloaded / total) * 100) : 0;
      if (pct !== lastPct && pct % 10 === 0) {
        process.stdout.write(`\r  ${pct}% (${(downloaded / 1e6).toFixed(0)} MB)`);
        lastPct = pct;
      }
      ctrl.enqueue(chunk);
    },
  });

  // @ts-ignore
  await pipeline(res.body.pipeThrough(progress), createWriteStream(dest));
  console.log(`\n  saved → ${dest}`);
}

function extract(archive: string): void {
  console.log(`  extracting…`);

  switch (PLATFORM) {
    case "win32": {
      // Use PowerShell to unzip — available on all modern Windows
      const tmp = join(OUT_DIR, "_extracted");
      execSync(
        `powershell -Command "Expand-Archive -Path '${archive}' -DestinationPath '${tmp}' -Force"`,
      );
      // The zip's top-level layout (ollama.exe + lib/ollama/** runner
      // binaries and backend DLLs) must be preserved as-is under OUT_DIR —
      // ollama.exe alone can list/pull models but cannot actually run
      // inference without lib/ollama/llama-server.exe alongside it.
      try {
        execSync(`robocopy "${tmp}" "${OUT_DIR}" /E /MOVE`, { shell: "cmd.exe" });
      } catch (e) {
        // robocopy's exit code is a bitmask; 0-7 all mean success, only 8+ is a real failure
        if (((e as { status?: number }).status ?? 0) >= 8) throw e;
      }
      // /MOVE already deletes tmp's contents (and usually tmp itself) as it
      // goes, so it may already be gone here — only clean up if it survived.
      if (existsSync(tmp)) execSync(`rmdir /S /Q "${tmp}"`, { shell: "cmd.exe" });
      if (!existsSync(OUT_FILE)) throw new Error("ollama.exe not found inside zip");
      break;
    }
    case "darwin":
      // Standard .tgz — extract the `ollama` binary
      execSync(`tar -xzf "${archive}" -C "${OUT_DIR}" --strip-components=0`);
      // The tgz may produce a file named differently; rename to `ollama`
      ensureNamedOllama();
      break;
    case "linux": {
      // .tar.zst requires the `zstd` tool (available on CI runners)
      execSync(`tar --use-compress-program=zstd -xf "${archive}" -C "${OUT_DIR}"`);
      // Unlike macOS's flat layout, the Linux tarball nests the daemon at
      // bin/ollama alongside lib/ollama/** (the runner engines). The generic
      // ensureNamedOllama() fallback assumes a single stray top-level file
      // and would instead grab the bin/ directory itself and rename that
      // whole directory to "ollama" — so handle this layout explicitly.
      const nestedBin = join(OUT_DIR, "bin", "ollama");
      if (existsSync(nestedBin)) {
        execSync(`mv "${nestedBin}" "${OUT_FILE}"`, { shell: "/bin/sh" });
        try { execSync(`rmdir "${join(OUT_DIR, "bin")}"`); } catch { /* non-empty or already gone */ }
      } else {
        ensureNamedOllama();
      }
      break;
    }
  }
}

/** If extraction produced a file other than `ollama`, rename it. */
function ensureNamedOllama(): void {
  if (existsSync(OUT_FILE)) return;
  const files = readdirSync(OUT_DIR).filter(
    (f) => f !== "ollama.exe" && !f.endsWith(".tgz") && !f.endsWith(".zst"),
  );
  if (files.length === 0) throw new Error("No binary found after extraction");
  const src = join(OUT_DIR, files[0]);
  execSync(
    process.platform === "win32"
      ? `move /Y "${src}" "${OUT_FILE}"`
      : `mv "${src}" "${OUT_FILE}"`,
    { shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" },
  );
}

function findFile(dir: string, name: string): string | null {
  try {
    const result = execSync(
      `dir /S /B "${join(dir, name)}"`,
      { shell: "cmd.exe", encoding: "utf-8" },
    ).trim().split("\n")[0]?.trim();
    return result || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (existsSync(OUT_FILE)) {
    console.log(`[download-ollama] already exists: ${OUT_FILE}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const { url, archive } = assetInfo();
  const archivePath = join(OUT_DIR, archive);

  console.log(`[download-ollama] platform=${PLATFORM} arch=${ARCH}`);
  await downloadFile(url, archivePath);
  extract(archivePath);

  // Clean up archive
  try { unlinkSync(archivePath); } catch {}

  // Make executable on Unix
  if (PLATFORM !== "win32") chmodSync(OUT_FILE, 0o755);

  console.log(`[download-ollama] ✓ ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("[download-ollama] failed:", err.message);
  process.exit(1);
});
