/**
 * Builds a true standalone Windows console executable for the CLI using
 * Node's Single Executable Application (SEA) support.
 *
 * Why this exists: the previous Windows CLI was a .cmd wrapper running the
 * bundle through the Electron binary (ELECTRON_RUN_AS_NODE=1). Electron's
 * exe is a GUI-subsystem binary, which doesn't attach to the parent console
 * properly on Windows — stdout came out as raw UTF-8 bytes decoded in the
 * legacy codepage (mojibake like "Γ¼í"), and stdin never connected at all,
 * so interactive commands (enzo-ai login) printed their prompt and exited
 * immediately. A real console-subsystem exe (copied from node.exe itself)
 * has none of these problems.
 *
 * The exe lands at cli/dist/sea/enzo-ai.exe and is shipped into the install
 * root by electron-builder (win.extraFiles), where it shadows the legacy
 * .cmd wrapper — cmd.exe's PATHEXT prefers .EXE over .CMD.
 *
 * No-op on non-Windows: mac/linux keep the bash wrapper, whose console
 * handling works fine with ELECTRON_RUN_AS_NODE.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

if (process.platform !== "win32") {
  console.log("[build-cli-sea] non-Windows platform — skipping (bash wrapper is used there)");
  process.exit(0);
}

const bundle = join(ROOT, "cli", "dist", "bundle", "index.js");
if (!existsSync(bundle)) {
  console.error("[build-cli-sea] cli/dist/bundle/index.js missing — run build:cli's ncc step first");
  process.exit(1);
}

const seaDir = join(ROOT, "cli", "dist", "sea");
mkdirSync(seaDir, { recursive: true });

const configPath = join(seaDir, "sea-config.json");
const blobPath = join(seaDir, "sea-prep.blob");
const exePath = join(seaDir, "enzo-ai.exe");

writeFileSync(configPath, JSON.stringify({
  main: bundle,
  output: blobPath,
  disableExperimentalSEAWarning: true,
}));

console.log("[build-cli-sea] generating SEA blob…");
execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });

console.log("[build-cli-sea] copying node.exe → enzo-ai.exe…");
copyFileSync(process.execPath, exePath);

console.log("[build-cli-sea] injecting blob…");
execFileSync(
  process.execPath,
  [
    join(ROOT, "node_modules", "postject", "dist", "cli.js"),
    exePath, "NODE_SEA_BLOB", blobPath,
    "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { stdio: "inherit" },
);

// Smoke test: the exe must run and report the CLI version.
const version = execFileSync(exePath, ["--version"], { encoding: "utf8" }).trim();
console.log(`[build-cli-sea] ✓ enzo-ai.exe works (v${version})`);
