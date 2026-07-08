#!/usr/bin/env node
/**
 * Copy onnxruntime-web WASM artifacts into the desktop public directory.
 *
 * ONNX Runtime Web loads its WASM binary at runtime relative to the executing
 * script. In a Vite dev server / Tauri build the Worker/module path does not
 * reliably resolve node_modules, so we publish the artifacts under /ort-wasm/
 * and point ort.env.wasm.wasmPaths there.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const onnxWebDir = join(
  repoRoot,
  'node_modules',
  '.pnpm',
  'onnxruntime-web@1.27.0',
  'node_modules',
  'onnxruntime-web',
  'dist',
);
const publicDest = join(repoRoot, 'apps', 'desktop', 'public', 'ort-wasm');

mkdirSync(publicDest, { recursive: true });

const files = readdirSync(onnxWebDir).filter(
  (f) => f.endsWith('.wasm') || f.endsWith('.mjs'),
);

for (const file of files) {
  copyFileSync(join(onnxWebDir, file), join(publicDest, file));
}

console.log(`Copied ${files.length} onnxruntime-web artifacts to ${publicDest}`);
