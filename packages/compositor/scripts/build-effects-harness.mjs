#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Builds the GPU-effects agreement harness bundle.
 *
 * The harness (`packages/compositor/src/webgpu/effects/harness.ts`) is an
 * IIFE bundle injected into a plain Playwright page — no app boot, no dev
 * server needed. esbuild resolves the workspace packages through their
 * package.json exports (TS source) and transpiles them in one pass.
 *
 * Usage: node scripts/build-effects-harness.mjs [outfile]
 */
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = process.argv[2] ?? join(root, 'dist', 'effects-harness.js');

await build({
  entryPoints: [join(root, 'src', 'webgpu', 'effects', 'harness.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile,
  logLevel: 'warning',
  // The harness runs in the page (not a worker); node builtins are absent.
  // wawoff2 etc. are only reachable through dynamic imports that the harness
  // never executes — external keeps them out of the bundle.
  external: [
    'fs',
    'path',
    'node:fs',
    'node:path',
    'wawoff2',
    'mp4-muxer',
    'webm-muxer',
    'opentype.js',
    'harfbuzzjs',
    'bidi-js',
  ],
});

console.log(`harness bundle written to ${outfile}`);

// Harness page (loads the bundle, reads ?effects= from the query string).
const pageSrc = join(root, '..', '..', 'tests', 'e2e', 'effects', 'gpu-harness-page.html');
const pageOut = join(root, 'dist', 'gpu-harness.html');
copyFileSync(pageSrc, pageOut);
console.log(`harness page written to ${pageOut}`);
