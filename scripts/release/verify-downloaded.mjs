#!/usr/bin/env node
/**
 * Verify downloaded release assets against the published checksum file.
 *
 * The release pipeline uploads dist/release/* to a draft, then downloads the
 * draft's assets again and runs this: every hash is recomputed from the
 * downloaded bytes and compared with SHA256SUMS.txt. This is the last gate
 * before human publication — it proves the bytes users will actually get are
 * the bytes that were built and checksummed, not a truncated or substituted
 * upload.
 *
 * Usage:
 *   node scripts/release/verify-downloaded.mjs \
 *     --dir verify-download --checksums dist/release/SHA256SUMS.txt
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseChecksums } from './verify-release-data.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir ?? 'verify-download');
  const checksumsPath = resolve(args.checksums ?? 'dist/release/SHA256SUMS.txt');
  if (!existsSync(dir)) throw new Error(`Download directory not found: ${dir}`);
  if (!existsSync(checksumsPath)) throw new Error(`Checksum file not found: ${checksumsPath}`);

  const sums = parseChecksums(readFileSync(checksumsPath, 'utf-8'));
  const problems = [];
  const onDisk = new Set(readdirSync(dir));

  for (const [name, expected] of sums) {
    if (name === 'SHA256SUMS.txt') continue;
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push(`Downloaded assets are missing ${name}`);
      continue;
    }
    onDisk.delete(name);
    const actual = sha256(path);
    if (actual !== expected) {
      problems.push(
        `${name}: downloaded bytes hash to ${actual.slice(0, 16)}… but SHA256SUMS.txt says ` +
          `${expected.slice(0, 16)}…`,
      );
    }
  }

  // The upload must not have gained files the checksum file does not cover.
  // SHA256SUMS.txt itself is the one legitimate extra: `gh release download
  // --pattern '*'` fetches it alongside the assets.
  for (const extra of onDisk) {
    if (extra === 'SHA256SUMS.txt') continue;
    problems.push(`Downloaded directory contains ${extra} which SHA256SUMS.txt does not list`);
  }

  if (problems.length > 0) {
    process.stderr.write('\nDownload verification FAILED:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `Downloaded ${sums.size - 1} asset(s) verified against SHA256SUMS.txt — ` +
      'uploaded bytes match the build.\n',
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
