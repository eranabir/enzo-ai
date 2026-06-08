// Ad-hoc code-signing hook for electron-builder (macOS).
//
// Until a real Apple Developer ID certificate + notarization are set up, the
// release build is unsigned — and an unsigned, quarantined app makes macOS
// Gatekeeper report it as "damaged and can't be opened" (right-click → Open
// does NOT help in that state).
//
// An *ad-hoc* signature (`codesign --sign -`) gives the app a valid—but
// untrusted—signature. Gatekeeper then reports the friendlier "unidentified
// developer" verdict, which the user CAN bypass via right-click → Open →
// "Open Anyway". No certificate, account, or notarization required.
//
// electron-builder 25 will not ad-hoc sign by itself (with no identity it skips
// signing entirely), so we plug in here via the `mac.sign` option. electron-
// builder calls this with the sign options object; `opts.app` is the .app path.
//
// NOTE: this hook is the FALLBACK. electron-builder.config.js only wires it in
// when CSC_LINK is absent; when the Developer ID / notarization secrets are set,
// the config does real signing instead and this hook is not used.

const { execFileSync } = require("node:child_process");

async function adHocSign(opts) {
  const appPath = opts && (opts.app || opts.appPath);
  if (!appPath) {
    console.warn("[ad-hoc-sign] no app path in sign options; skipping");
    return;
  }
  console.log(`[ad-hoc-sign] ad-hoc signing ${appPath}`);
  // --deep signs nested helpers, frameworks and bundled binaries (ollama, the
  // better-sqlite3 .node, the ncc bundles) with the same ad-hoc identity.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  console.log("[ad-hoc-sign] done");
}

module.exports = adHocSign;
module.exports.default = adHocSign;
