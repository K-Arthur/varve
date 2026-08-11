#!/usr/bin/env node
/**
 * Copy onnxruntime-web WASM artifacts into the desktop public directory.
 *
 * ONNX Runtime Web loads its WASM binary at runtime relative to the executing
 * script. In a Vite dev server / Tauri build the Worker/module path does not
 * reliably resolve node_modules, so we publish the artifacts under /ort-wasm/
 * and point ort.env.wasm.wasmPaths there.
 *
 * Also ensures Git LFS-tracked model files (*.onnx) are materialized before
 * the build — without this, CI clones with `--skip-smudge` would ship
 * pointer files instead of real model weights.
 */
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

const onnxWebDir = findOnnxWebDir();
const packageJsonPath = join(onnxWebDir, '..', 'package.json');
const packageVersion = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
const files = readdirSync(onnxWebDir).filter((f) => f.endsWith('.wasm') || f.endsWith('.mjs'));

const requiredFiles = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];
for (const requiredFile of requiredFiles) {
  if (!files.includes(requiredFile)) {
    throw new Error(
      `onnxruntime-web ${packageVersion} is missing required runtime companion ${requiredFile}`,
    );
  }
}

// The directory is generated and gitignored. Clear it before copying so a
// package upgrade cannot leave stale companions that mask an incomplete
// install or make diagnostics report the wrong runtime version.
rmSync(publicDest, { recursive: true, force: true });
mkdirSync(publicDest, { recursive: true });

for (const file of files) {
  copyFileSync(join(onnxWebDir, file), join(publicDest, file));
}

writeFileSync(
  join(publicDest, 'manifest.json'),
  `${JSON.stringify({ package: 'onnxruntime-web', version: packageVersion, requiredFiles, files }, null, 2)}\n`,
);

console.log(
  `Copied and validated ${files.length} onnxruntime-web ${packageVersion} artifacts from ${onnxWebDir} to ${publicDest}`,
);

// Ensure LFS-tracked model files are materialized (not pointer files).
const modelsDir = join(repoRoot, 'apps', 'desktop', 'public', 'models');
try {
  // Check if any .onnx file is a LFS pointer (starts with "version https://git-lfs").
  // NOTE: the needle below is 21 chars and readFileSync().slice() must cover it
  // all — a 20-char slice can never equal it, which silently disabled the
  // materialization fallback (fixed 2026-08-10; CI now also checks out with
  // lfs: true, but this path still guards shallow/third-party checkouts).
  const LFS_POINTER_PREFIX = 'version https://git-lfs';
  let needsSmudge = false;
  for (const f of readdirSync(modelsDir)) {
    if (!f.endsWith('.onnx')) continue;
    const head = readFileSync(join(modelsDir, f), 'utf8').slice(0, LFS_POINTER_PREFIX.length);
    if (head === LFS_POINTER_PREFIX) {
      needsSmudge = true;
      break;
    }
  }
  if (needsSmudge) {
    console.log('LFS: materializing *.onnx model files...');
    execSync('git lfs pull --include="*.onnx"', { cwd: repoRoot, stdio: 'inherit' });
    console.log('LFS: model files materialized.');
  }
} catch {
  // LFS not installed or no pointer files — safe to ignore.
}
