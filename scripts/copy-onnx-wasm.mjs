#!/usr/bin/env node
/**
 * Copy onnxruntime-web WASM artifacts into the desktop public directory.
 *
 * ONNX Runtime Web loads its WASM binary at runtime relative to the executing
 * script. In a Vite dev server / Tauri build the Worker/module path does not
 * reliably resolve node_modules, so we publish the artifacts under /ort-wasm/
 * and point ort.env.wasm.wasmPaths there.
 */
import { copyFileSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const publicDest = join(repoRoot, 'apps', 'desktop', 'public', 'ort-wasm');

function findOnnxWebDir() {
  // pnpm workspace packages are not always hoisted to the root node_modules.
  // Check the desktop package symlink first, then root, then the .pnpm store.
  const candidates = [
    join(repoRoot, 'apps', 'desktop', 'node_modules', 'onnxruntime-web', 'dist'),
    join(repoRoot, 'node_modules', 'onnxruntime-web', 'dist'),
    ...globPnpmOnnxDirs(),
  ];

  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      if (statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Candidate missing or broken; continue probing.
    }
  }

  throw new Error(
    `Cannot find onnxruntime-web/dist. Run pnpm install in the workspace root. ` +
      `Searched: ${candidates.join(', ')}`,
  );
}

function globPnpmOnnxDirs() {
  const pnpmRoot = join(repoRoot, 'node_modules', '.pnpm');
  try {
    return readdirSync(pnpmRoot)
      .filter((name) => name.startsWith('onnxruntime-web@'))
      .map((name) => join(pnpmRoot, name, 'node_modules', 'onnxruntime-web', 'dist'))
      .filter((candidate) => {
        try {
          return statSync(realpathSync(candidate)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

mkdirSync(publicDest, { recursive: true });

const onnxWebDir = findOnnxWebDir();
const files = readdirSync(onnxWebDir).filter((f) => f.endsWith('.wasm') || f.endsWith('.mjs'));

for (const file of files) {
  copyFileSync(join(onnxWebDir, file), join(publicDest, file));
}

console.log(`Copied ${files.length} onnxruntime-web artifacts from ${onnxWebDir} to ${publicDest}`);
