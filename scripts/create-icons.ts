/**
 * Generate all Enzo icon assets from code.
 * Run: npx tsx scripts/create-icons.ts
 *
 * Produces in desktop/assets/:
 *   icon.png          512×512  (Linux app icon / master)
 *   icon.ico                   (Windows app icon, multi-size)
 *   tray.png           22×22   (Linux tray)
 *   tray.ico                   (Windows tray, multi-size)
 *   trayTemplate.png   22×22   (macOS menu bar — white monochrome)
 *   trayTemplate@2x.png 44×44  (macOS Retina)
 *
 * icon.icns (macOS .app icon) is produced by macOS's `iconutil` and must be
 * built on a Mac. The GitHub Actions CI handles this automatically.
 */

import sharp from "sharp";
import pngToIco from "png-to-ico";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "desktop", "assets");
mkdirSync(OUT, { recursive: true });

// ── Brand colours ──────────────────────────────────────────────────────────
const ACCENT = "#6d5efc";
const BG     = "#16181f";

// ── SVG templates ──────────────────────────────────────────────────────────

/** Flat-top hexagon, accent-coloured on a rounded-rect dark background. */
function appIconSvg(size: number): string {
  const r = size * 0.18;          // corner radius
  const pad = size * 0.12;        // padding around hex
  const hex = hexPoints(size, pad);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  <polygon points="${hex}" fill="${ACCENT}"/>
</svg>`;
}

/** White hexagon on transparent — for macOS tray template image. */
function trayTemplateSvg(size: number): string {
  const hex = hexPoints(size, size * 0.08);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <polygon points="${hex}" fill="white"/>
</svg>`;
}

/** Accent-coloured hexagon on transparent — for Windows/Linux tray. */
function trayColorSvg(size: number): string {
  const hex = hexPoints(size, size * 0.08);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <polygon points="${hex}" fill="${ACCENT}"/>
</svg>`;
}

/** Compute flat-top hexagon polygon points centred in a square of `size`. */
function hexPoints(size: number, pad: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2 - pad;
  // Flat-top hexagon: vertices at 0°, 60°, 120°, 180°, 240°, 300°
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i);
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function svgToPng(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toBuffer();
}

async function writePng(svg: string, size: number, filename: string): Promise<Buffer> {
  const buf = await svgToPng(svg, size);
  const path = join(OUT, filename);
  writeFileSync(path, buf);
  console.log(`  ✓ ${filename} (${size}×${size})`);
  return buf;
}

async function writeIco(buffers: Buffer[], filename: string): Promise<void> {
  const ico = await pngToIco(buffers);
  writeFileSync(join(OUT, filename), ico);
  console.log(`  ✓ ${filename} (${buffers.length} sizes)`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n[create-icons] generating icons…\n");

  // App icons (with dark background)
  const app256 = await writePng(appIconSvg(256), 256, "_app-256.png");
  const app128 = await writePng(appIconSvg(128), 128, "_app-128.png");
  const app64  = await writePng(appIconSvg(64),  64,  "_app-64.png");
  const app48  = await writePng(appIconSvg(48),  48,  "_app-48.png");
  const app32  = await writePng(appIconSvg(32),  32,  "_app-32.png");
  const app16  = await writePng(appIconSvg(16),  16,  "_app-16.png");
  const app512 = await writePng(appIconSvg(512), 512, "icon.png");

  // Windows/Linux app icon (.ico — multiple sizes in one file)
  await writeIco([app256, app128, app64, app48, app32, app16], "icon.ico");

  // Tray icons — Windows & Linux (coloured)
  const tray22 = await writePng(trayColorSvg(22), 22, "tray.png");
  const tray32 = await writePng(trayColorSvg(32), 32, "_tray-32.png");
  await writeIco([tray32, tray22], "tray.ico");

  // Tray icons — macOS (white monochrome template)
  await writePng(trayTemplateSvg(22), 22, "trayTemplate.png");
  await writePng(trayTemplateSvg(44), 44, "trayTemplate@2x.png");

  // Clean up temp files
  const tmp = ["_app-256","_app-128","_app-64","_app-48","_app-32","_app-16","_tray-32"];
  for (const f of tmp) {
    try { require("node:fs").unlinkSync(join(OUT, `${f}.png`)); } catch {}
  }

  console.log(`\n[create-icons] done → ${OUT}\n`);
  console.log("  Note: icon.icns (macOS) requires running on macOS with iconutil.");
  console.log("  The GitHub Actions CI handles this automatically.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
