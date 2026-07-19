// electron-builder configuration (replaces electron-builder.yml).
//
// MUST NOT be named electron-builder.js: cmd.exe (which yarn uses to run
// scripts on Windows) resolves bare commands from the current directory before
// PATH, and PATHEXT includes .JS — so `electron-builder` run inside desktop/
// would execute this config via Windows Script Host instead of the real CLI,
// exiting 0 without building anything. Since this name isn't auto-discovered,
// every package.json script passes it explicitly via --config.
//
// macOS signing is ENV-DRIVEN so builds never fail for missing credentials:
//
//   • Real Developer ID signing + notarization — used when CSC_LINK is set.
//     Requires these env vars (set from GitHub secrets in CI):
//       CSC_LINK            base64 of the "Developer ID Application" .p12
//       CSC_KEY_PASSWORD    password for that .p12
//       APPLE_API_KEY       path to the App Store Connect API key (.p8 file)
//       APPLE_API_KEY_ID    the key's Key ID
//       APPLE_API_ISSUER    the App Store Connect Issuer ID
//     Produces a notarized, Gatekeeper-trusted app (no warning on launch).
//
//   • Ad-hoc fallback — used when CSC_LINK is absent. Signs with `codesign
//     --sign -` so Gatekeeper says "unidentified developer" (bypassable via
//     right-click → Open) instead of "damaged". No account or secrets needed.
//
// The macos CI job passes the signing env from secrets; if they're empty the
// build automatically falls back to ad-hoc.

const realSigning = !!process.env.CSC_LINK;

const mac = {
  category: "public.app-category.productivity",
  icon: "assets/icon.icns",
  entitlements: "build/entitlements.mac.plist",
  entitlementsInherit: "build/entitlements.mac.plist",
  gatekeeperAssess: false,
  target: [{ target: "dmg" }],
  ...(realSigning
    ? // Developer ID + notarization (hardened runtime is required to notarize).
      { hardenedRuntime: true, notarize: true }
    : // Ad-hoc: custom hook signs with `codesign --sign -`; no hardened runtime
      // (avoids library-validation issues with the bundled native module/ollama).
      { sign: "build/ad-hoc-sign.js", hardenedRuntime: false, notarize: false }),
};

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.enzo-ai.app",
  productName: "Enzo AI",
  copyright: "© 2026 Eran Abir",
  electronVersion: "34.5.8",

  // NOTE: electron-builder's output also lands in dist/ (mac-arm64/, *.dmg, …).
  // Globbing dist/**/* would recursively package the build's own output back
  // into the asar. The compiled main process is only the top-level dist/*.js.
  files: ["dist/*.js", "src/setup.html", "package.json"],

  // Placed directly in the install root, alongside the app, so the enzo-ai
  // wrapper scripts are on PATH.
  extraFiles: [
    { from: "cli-wrappers/enzo-ai.cmd", to: "enzo-ai.cmd" },
    { from: "cli-wrappers/enzo-ai", to: "enzo-ai" },
  ],

  extraResources: [
    { from: "assets", to: "assets", filter: ["tray*", "icon*"] },
    { from: "../cli/dist/bundle", to: "cli/bundle", filter: ["**/*"] },
    { from: "../server/dist/bundle", to: "server/bundle", filter: ["**/*"] },
    { from: "../node_modules/better-sqlite3", to: "node_modules/better-sqlite3", filter: ["**/*"] },
    { from: "../node_modules/bindings", to: "node_modules/bindings", filter: ["**/*"] },
    { from: "../node_modules/file-uri-to-path", to: "node_modules/file-uri-to-path", filter: ["**/*"] },
    // Scanned-PDF OCR fallback (rasterize + Tesseract) for the bundled server.
    { from: "../node_modules/@napi-rs", to: "node_modules/@napi-rs", filter: ["**/*"] },
    { from: "../node_modules/pdfjs-dist", to: "node_modules/pdfjs-dist", filter: ["**/*"] },
    { from: "../node_modules/tesseract.js", to: "node_modules/tesseract.js", filter: ["**/*"] },
    { from: "../node_modules/tesseract.js-core", to: "node_modules/tesseract.js-core", filter: ["**/*"] },
    { from: "../node_modules/idb-keyval", to: "node_modules/idb-keyval", filter: ["**/*"] },
    { from: "../node_modules/is-url", to: "node_modules/is-url", filter: ["**/*"] },
    { from: "../node_modules/bmp-js", to: "node_modules/bmp-js", filter: ["**/*"] },
    { from: "../node_modules/zlibjs", to: "node_modules/zlibjs", filter: ["**/*"] },
    { from: "../node_modules/wasm-feature-detect", to: "node_modules/wasm-feature-detect", filter: ["**/*"] },
    { from: "../node_modules/regenerator-runtime", to: "node_modules/regenerator-runtime", filter: ["**/*"] },
    { from: "../web/dist", to: "web/dist", filter: ["**/*"] },
    { from: "resources/ollama", to: "ollama", filter: ["**/*"] },
    { from: "../LICENSE", to: "LICENSE" },
    { from: "../THIRD_PARTY_NOTICES.md", to: "THIRD_PARTY_NOTICES.md" },
  ],

  npmRebuild: true,
  buildDependenciesFromSource: false,

  mac,

  dmg: {
    artifactName: "enzo-ai-macos-${version}-${arch}.${ext}",
    title: "Install Enzo AI",
    window: { width: 540, height: 380 },
  },

  win: {
    icon: "assets/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
  },

  nsis: {
    artifactName: "enzo-ai-windows-${version}.${ext}",
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    include: "build/installer.nsh",
  },

  linux: {
    icon: "assets/icon.png",
    category: "Utility",
    target: [{ target: "deb", arch: ["x64"] }],
  },

  deb: {
    artifactName: "enzo-ai-linux-${version}-${arch}.${ext}",
  },
};
