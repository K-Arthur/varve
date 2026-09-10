#!/usr/bin/env node
/**
 * Remove staged ONNX Runtime libraries that do not belong to the platform being
 * packaged.
 *
 * `tauri.conf.json` bundles `onnxruntime-libs/**` wholesale, and
 * `fetch-onnxruntime.mjs` stages one directory per platform it has ever been
 * asked for. On a developer machine that has fetched more than one — or simply
 * been used for a while — every one of them ends up inside the installer.
 *
 * Measured in a real 74 MB .deb built on this machine:
 *
 *   linux-x86_64/libonnxruntime.so     23.7 MB   used
 *   macos-aarch64/libonnxruntime.dylib 38.5 MB   dead weight
 *   windows-x86_64/onnxruntime.dll     15.4 MB   dead weight
 *
 * 53.9 MB of a Linux package was libraries no Linux machine can load — more
 * than the useful payload. That matters directly for the 4 GB RAM target and
 * for anyone downloading over a slow connection.
 *
 * Run before `tauri build` in any packaging path. Safe and idempotent: the
 * pruned directories are regenerated on demand by `fetch-onnxruntime.mjs`.
 *
 *   node scripts/release/prune-foreign-runtimes.mjs [--target linux-x86_64] [--dry-run]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentTargetId, normalizeTargetId } from './targets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGE_DIR = join(repoRoot, 'apps/desktop/src-tauri/onnxruntime-libs');

/** Matches `format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)` on the Rust side. */
function currentPlatformKey() {
  return currentTargetId();
}

function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : statSync(full).size;
  }
  return total;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetIndex = args.indexOf('--target');
  const target =
    targetIndex !== -1 ? normalizeTargetId(args[targetIndex + 1]) : currentPlatformKey();

  if (!existsSync(STAGE_DIR)) {
    process.stdout.write(
      `[prune-foreign-runtimes] Nothing staged at ${STAGE_DIR} — nothing to prune.\n`,
    );
    return;
  }

  const staged = readdirSync(STAGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  let freed = 0;
  let kept = false;

  for (const name of staged) {
    const dir = join(STAGE_DIR, name);
    if (name === target) {
      kept = true;
      process.stdout.write(`[prune-foreign-runtimes] keep   ${name}\n`);
      continue;
    }
    const size = directorySize(dir);
    freed += size;
    process.stdout.write(
      `[prune-foreign-runtimes] ${dryRun ? 'would remove' : 'remove'} ${name} ` +
        `(${(size / 1_000_000).toFixed(1)} MB)\n`,
    );
    if (!dryRun) rmSync(dir, { recursive: true, force: true });
  }

  if (!kept) {
    // Not fatal: the ai feature uses load-dynamic, so a missing library degrades
    // to the WASM/heuristic provider rather than failing to build or start.
    process.stdout.write(
      `[prune-foreign-runtimes] WARNING: no library staged for '${target}'. Native AI will ` +
        'fall back to WASM at runtime. Run `node scripts/fetch-onnxruntime.mjs` to stage it.\n',
    );
  }

  process.stdout.write(
    `[prune-foreign-runtimes] ${dryRun ? 'Would free' : 'Freed'} ` +
      `${(freed / 1_000_000).toFixed(1)} MB from the bundle.\n`,
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`[prune-foreign-runtimes] ${err.message}\n`);
  process.exit(1);
}
