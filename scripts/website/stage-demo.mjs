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
import { cpSync, existsSync, mkdirSync } from 'node:fs';
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

const wasmDir = join(demoDest, 'wasm');
if (!existsSync(wasmDir)) {
  console.warn('[stage-demo] wasm/ directory missing — WASM features will not work');
}

console.log('[stage-demo] Done');
