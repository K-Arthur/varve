#!/usr/bin/env node
/**
 * Publish the large on-demand models as assets on a dedicated GitHub release.
 *
 * The two DDColor models are custom ONNX exports with no upstream URL, so the
 * project has to host them. They are deliberately NOT bundled — together they
 * are 1.2 GB, against a 74 MB installer.
 *
 * A dedicated `models-v1` tag rather than the app release:
 *   - release-asset bandwidth is unmetered, and does not touch the 10 GB/month
 *     Git LFS allowance;
 *   - model URLs stay stable across app versions;
 *   - a 1.2 GB upload does not have to be repeated on every app release.
 *
 * Every file is hashed and checked against the pinned SHA-256 in the model
 * catalog BEFORE upload. A corrupt or pointer-file LFS checkout must never
 * become a published asset — every client verifies the same hash and would
 * reject it, turning one bad upload into a broken feature for everyone.
 *
 *   node scripts/release/publish-model-assets.mjs --dry-run
 *   node scripts/release/publish-model-assets.mjs
 *
 * Requires `gh` authenticated with write access. This uploads to a public
 * release — it is a publishing action, so it is never run automatically.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productSlug, repoSlug } from './product.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIR = join(repoRoot, 'models-source');
const TAG = 'models-v1';

/** Models this script is responsible for hosting. Upstream-hosted models are not listed. */
const HOSTED = ['ddcolor.onnx', 'ddcolor-tiny.onnx'];

const LFS_MAGIC = 'version https://git-lfs.github.com/spec/v1';

function catalogChecksums() {
  const text = readFileSync(
    join(repoRoot, 'packages/engine/src/inference/modelCatalog.ts'),
    'utf-8',
  );
  const map = new Map();
  for (const entry of text.split(/^\s*id:\s*'/m).slice(1)) {
    const id = entry.slice(0, entry.indexOf("'"));
    const checksum = entry.match(/^\s*checksum:\s*'([0-9a-f]{64})'/m)?.[1];
    if (id && checksum) map.set(`${id}.onnx`, checksum);
  }
  return map;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const checksums = catalogChecksums();
  const problems = [];
  const ready = [];

  for (const filename of HOSTED) {
    const path = join(SOURCE_DIR, filename);

    if (!existsSync(path)) {
      problems.push(`${filename}: not found in models-source/`);
      continue;
    }

    const size = statSync(path).size;
    if (size < 2048 && readFileSync(path, 'utf-8').startsWith(LFS_MAGIC)) {
      problems.push(
        `${filename}: this is a ${size}-byte Git LFS pointer, not the model.\n` +
          '    Run: git lfs pull --include="models-source/*.onnx"',
      );
      continue;
    }

    const expected = checksums.get(filename);
    if (!expected) {
      problems.push(`${filename}: no pinned checksum found in modelCatalog.ts`);
      continue;
    }

    const actual = sha256(path);
    if (actual !== expected) {
      problems.push(
        `${filename}: SHA-256 mismatch — refusing to publish.\n` +
          `    expected ${expected}\n    actual   ${actual}\n` +
          '    Every client verifies this hash; publishing a mismatch breaks the\n' +
          '    feature for everyone rather than just failing here.',
      );
      continue;
    }

    ready.push({ filename, path, size, sha256: actual });
  }

  for (const { filename, size, sha256: hash } of ready) {
    process.stdout.write(
      `  OK  ${filename.padEnd(22)} ${(size / 1_000_000).toFixed(0).padStart(5)} MB  ${hash.slice(0, 16)}…\n`,
    );
  }

  if (problems.length > 0) {
    process.stderr.write('\nCannot publish:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }

  const totalMb = ready.reduce((n, r) => n + r.size, 0) / 1_000_000;
  process.stdout.write(`\n${ready.length} asset(s), ${totalMb.toFixed(0)} MB total.\n`);

  if (dryRun) {
    process.stdout.write('Dry run — nothing uploaded.\n');
    return;
  }

  // Create the release only if it does not exist; never clobber published
  // assets, because their hashes are pinned in shipped clients.
  let exists = true;
  try {
    execFileSync('gh', ['release', 'view', TAG], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    exists = false;
  }

  if (!exists) {
    process.stdout.write(`Creating release ${TAG}…\n`);
    execFileSync(
      'gh',
      [
        'release',
        'create',
        TAG,
        '--title',
        `${productSlug()} AI models (v1)`,
        '--notes',
        `On-demand AI models downloaded by ${productSlug()}. Not an application release.\n\n` +
          'These are pinned by SHA-256 in the app; assets here are never overwritten. ' +
          'A revised model ships as models-v2.',
        '--latest=false',
      ],
      { cwd: repoRoot, stdio: 'inherit' },
    );
  }

  for (const { filename, path } of ready) {
    process.stdout.write(`Uploading ${filename}…\n`);
    // No --clobber: overwriting an asset would break checksum verification for
    // every client that already pinned the old hash.
    execFileSync('gh', ['release', 'upload', TAG, path], { cwd: repoRoot, stdio: 'inherit' });
  }

  process.stdout.write(`\nDone. Verify a download resolves:\n`);
  for (const { filename } of ready) {
    process.stdout.write(
      `  curl -sIL https://github.com/${repoSlug()}/releases/download/${TAG}/${filename} | head -1\n`,
    );
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
