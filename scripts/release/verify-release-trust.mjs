#!/usr/bin/env node
/**
 * Release trust gate: merge per-runner manifests, fold in the per-platform
 * signing verification reports, and enforce the fail-closed signing policy.
 *
 * This is the step that makes "signed" a fact about the artifact bytes rather
 * than a claim. A stable release whose Windows/macOS artifacts do not carry
 * the required verified signatures FAILS here — before the draft is created,
 * before any checksum is generated, and before any bytes are uploaded.
 *
 * Ordering contract enforced by the workflow validator: this job runs BEFORE
 * generate-final-checksums, so the published hashes always describe the final
 * verified bytes.
 *
 * Usage:
 *   node scripts/release/verify-release-trust.mjs \
 *     --staged staged \
 *     --out dist/release \
 *     --channel stable|prerelease \
 *     --expect-signed true|false \
 *     [--expected-publisher "Verified Name"]
 *
 * Exits non-zero on any policy violation.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeManifests } from './merge-manifests.mjs';
import { readSigningReports, verifyReleaseTrust } from './signing-policy.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stagedDir = resolve(repoRoot, args.staged ?? 'staged');
  const outDir = resolve(repoRoot, args.out ?? 'dist/release');
  const channel = args.channel ?? 'prerelease';
  const expectSigned = args['expect-signed'] === 'true';
  const expectedPublisher = args['expected-publisher'] ?? null;

  if (!existsSync(stagedDir)) {
    throw new Error(`Staged artifact directory not found: ${stagedDir}`);
  }
  mkdirSync(outDir, { recursive: true });

  // 1. Merge per-runner manifests + signing reports into one manifest.
  const manifest = mergeManifests({ stagedDir, outDir });

  // 2. Enforce the trust policy against the merged manifest and reports.
  const reports = readSigningReports(stagedDir);
  const { problems, notes } = verifyReleaseTrust({
    channel,
    expectSigned,
    manifest,
    reports,
    expectedPublisher,
  });

  for (const note of notes) process.stdout.write(`  note: ${note}\n`);

  if (problems.length > 0) {
    process.stderr.write('\nRelease trust gate FAILED:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(
      '\nA signed release never falls back to unsigned. Fix the signing or the tag before ' +
        'continuing.\n',
    );
    process.exit(1);
  }

  const platforms = [...new Set(manifest.artifacts.map((a) => a.os))].sort();
  process.stdout.write(
    `\nRelease trust gate PASSED for ${manifest.version} (${platforms.join(', ')}).\n`,
  );
  process.stdout.write(`  signed: ${manifest.signed}, notarized: ${manifest.notarized}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
