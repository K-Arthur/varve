#!/usr/bin/env node
/**
 * Stage the browser-demo build into the website dist for a combined
 * GitHub Pages deployment.
 *
 * Usage:
 *   node scripts/website/stage-demo.mjs
 *
 * Expects:
 *   apps/desktop/dist-try/  — the demo build output (VITE_BASE_URL=/try/)
 *   apps/website/dist/      — the Astro website build output
 *
 * Result:
 *   apps/website/dist/try/  — the demo app at the /try/ sub-path
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..', '..');
const demoSrc = join(repoRoot, 'apps', 'desktop', 'dist-try');
const websiteDist = join(repoRoot, 'apps', 'website', 'dist');
const demoDest = join(websiteDist, 'try');

if (!existsSync(demoSrc)) {
  console.error(
    `[stage-demo] Demo build not found at ${demoSrc}.\n` +
      `Run: pnpm --filter @varve/desktop build:try`,
  );
  process.exit(1);
}

if (!existsSync(websiteDist)) {
  console.error(
    `[stage-demo] Website dist not found at ${websiteDist}.\n` +
      `Run: pnpm --filter @varve/website build`,
  );
  process.exit(1);
}

mkdirSync(demoDest, { recursive: true });
cpSync(demoSrc, demoDest, { recursive: true });

console.log(`[stage-demo] Staged demo build into ${demoDest}`);

// Verify key assets exist.
const index = join(demoDest, 'index.html');
if (!existsSync(index)) {
  console.error('[stage-demo] try/index.html missing after staging');
  process.exit(1);
}

// `/try/` is intentionally in the sitemap, so it needs a real search/link
// preview head rather than the desktop shell's generic title. Fail the stage
// before deployment if the Vite transform is removed or runs in the wrong
// build mode.
const indexHtml = readFileSync(index, 'utf8');
const requiredSeo = [
  '<title>Try Varve in your browser — Varve design suite</title>',
  '<meta name="description"',
  '<meta name="robots" content="index, follow" />',
  '<link rel="canonical" href="https://varve.studio/try/" />',
  '<meta property="og:image" content="https://varve.studio/og-image.png" />',
  '<meta name="twitter:card" content="summary_large_image" />',
  '<script type="application/ld+json">',
];
const missingSeo = requiredSeo.filter((fragment) => !indexHtml.includes(fragment));
if (missingSeo.length > 0) {
  console.error(`[stage-demo] Demo metadata is incomplete; missing: ${missingSeo.join(', ')}`);
  process.exit(1);
}

const wasmDir = join(demoDest, 'wasm');
if (!existsSync(wasmDir)) {
  console.warn('[stage-demo] wasm/ directory missing — WASM features will not work');
}

// Size budget. GitHub Pages refuses to publish a site over 1 GB, and this
// script copies whatever the build left behind — so a machine with a warm ONNX
// model cache used to stage ~700 MB without a word (Vite copies public/
// wholesale, and public/models is gitignored, so CI and a developer's laptop
// produce very different artifacts). Failing here is much cheaper than a
// deploy that either breaks the size cap or quietly ships hundreds of
// megabytes of models the demo cannot even use.
const BUDGET_MB = 120;

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(full) : statSync(full).size;
  }
  return total;
}

const stagedMb = dirSizeBytes(demoDest) / 1024 / 1024;
if (stagedMb > BUDGET_MB) {
  console.error(
    `[stage-demo] Staged demo is ${stagedMb.toFixed(1)} MB, over the ${BUDGET_MB} MB budget.\n` +
      `The demo withholds on-device inference, so models/ and ort-wasm/ should have been\n` +
      `pruned by the demo-asset-prune Vite plugin. Rebuild with:\n` +
      `  pnpm --filter @varve/desktop build:try`,
  );
  process.exit(1);
}
console.log(`[stage-demo] Staged demo is ${stagedMb.toFixed(1)} MB (budget ${BUDGET_MB} MB)`);

console.log('[stage-demo] Done');
