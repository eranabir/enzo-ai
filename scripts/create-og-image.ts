// Generates site/og-image.png (1200x630) — the social link-preview card
// referenced by the og:image / twitter:image meta tags on the landing page.
// Run: npx tsx scripts/create-og-image.ts
import sharp from "sharp";
import { join } from "path";

const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g1" cx="15%" cy="0%" r="70%">
      <stop offset="0%" stop-color="#3b2d7a"/>
      <stop offset="100%" stop-color="#03020c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="90%" cy="100%" r="65%">
      <stop offset="0%" stop-color="#173d5c"/>
      <stop offset="100%" stop-color="#03020c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8b7cf6"/>
      <stop offset="100%" stop-color="#5ea2ef"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#03020c"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>

  <!-- hexagon mark -->
  <polygon points="160,120 105,151 105,214 160,245 215,214 215,151"
           fill="none" stroke="url(#accent)" stroke-width="7" stroke-linejoin="round"/>

  <text x="100" y="385" font-family="Segoe UI, Arial, sans-serif" font-size="118"
        font-weight="700" fill="#ffffff">EnzoAI</text>

  <text x="103" y="455" font-family="Segoe UI, Arial, sans-serif" font-size="42"
        fill="rgba(255,255,255,0.78)">Your AI. Your Machine. Your Rules.</text>

  <text x="103" y="530" font-family="Segoe UI, Arial, sans-serif" font-size="30"
        fill="#8b7cf6">Self-hosted &#183; Local-first &#183; Open source (MIT)</text>
</svg>`;

async function main() {
  const out = join(__dirname, "..", "site", "og-image.png");
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log("wrote", out);
}

main();
