#!/usr/bin/env node
/**
 * Write the website's release data from a locally generated release manifest.
 *
 * This is the OFFLINE path, used by the release rehearsal and local
 * development: the manifest comes from a merged dist/release directory built
 * by the release pipeline, and the website manifest is written from it after
 * cross-checking the local SHA256SUMS.txt.
 *
 * The CI deploy path is scripts/release/fetch-website-release.mjs, which reads
 * the exact published GitHub Release instead. Both write through
 * website-release-data.mjs so the download page consumes one shape.
 *
 * Usage:
 *   node scripts/release/update-website-manifest.mjs \
 *     --manifest dist/release/release-manifest.json \
 *     --tag v0.1.0 \
 *     [--repo K-Arthur/varve]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoSlug } from './product.mjs';
import { buildWebsiteReleaseData } from './website-release-data.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(repoRoot, 'apps/website/src/data/release-manifest.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo ?? repoSlug();
  const tag = args.tag;
  if (!tag) throw new Error('--tag is required (e.g. --tag v0.1.0)');

  const manifest = JSON.parse(readFileSync(resolve(repoRoot, args.manifest), 'utf-8'));
  const checksumsPath = resolve(dirname(resolve(repoRoot, args.manifest)), 'SHA256SUMS.txt');
  const checksumsText = readFileSync(checksumsPath, 'utf-8');

  const sbomFilenames = [];
  for (const artifact of manifest.artifacts ?? []) {
    if (!['linux', 'macos', 'windows'].includes(artifact.os)) {
      throw new Error(`Unknown platform "${artifact.os}" in manifest — refusing to advertise it`);
    }
  }

  const website = buildWebsiteReleaseData({
    repo,
    tag,
    manifest,
    checksumsText,
    sbomFilenames,
    integrity: 'verified',
  });

  writeFileSync(OUT, `${JSON.stringify(website, null, 2)}\n`);

  process.stdout.write(`Website release data written to ${OUT}\n`);
  for (const [os, list] of Object.entries(website.platforms)) {
    process.stdout.write(`  ${os}: ${list.map((a) => a.format).join(', ')}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
