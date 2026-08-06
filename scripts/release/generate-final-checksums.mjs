#!/usr/bin/env node
/**
 * Generate the final SHA256SUMS.txt for a release directory.
 *
 * This MUST run last, after every artifact (installers, release-manifest.json,
 * SBOMs) is in place, so the checksum file describes the exact bytes that are
 * about to be uploaded. Deterministic format, `sha256sum -c` compatible:
 *
 *   <64-char lowercase sha256><two spaces><filename>
 *
 * The file does not hash itself. Rejection rules (each is a hard error):
 *   - duplicate filenames
 *   - unsafe paths (absolute, `..` traversal)
 *   - newlines in filenames
 *   - zero-byte files
 *   - Git LFS pointer files (133-byte "version https://git-lfs..." stubs)
 *   - placeholder-looking files (the 0.0.0 version placeholder)
 *   - leftover per-platform SHA256SUMS.txt files from the matrix runners
 *
 * Usage:
 *   node scripts/release/generate-final-checksums.mjs --dir dist/release
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Git LFS pointer files are tiny text stubs with a fixed first line. */
function isLfsPointer(bytes) {
  return bytes.length < 200 && bytes.toString('utf-8').startsWith('version https://git-lfs');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir ?? 'dist/release');
  if (!existsSync(dir)) throw new Error(`Release directory not found: ${dir}`);

  const entries = readdirSync(dir).filter((name) => name !== 'SHA256SUMS.txt');
  if (entries.length === 0) throw new Error(`${dir} is empty — nothing to checksum`);

  const seen = new Set();
  const lines = [];

  for (const name of entries.sort()) {
    if (name.includes('\n') || name.includes('\r')) {
      throw new Error(`Filename contains a newline: ${JSON.stringify(name)}`);
    }
    if (name.startsWith('/') || name.includes('..')) {
      throw new Error(`Unsafe filename: ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate filename: ${name}`);
    seen.add(name);

    const path = join(dir, name);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    if (stat.size === 0) throw new Error(`Zero-byte file in release directory: ${name}`);

    const bytes = readFileSync(path);
    if (isLfsPointer(bytes)) {
      throw new Error(
        `Git LFS pointer found in release directory: ${name} — ` +
          'the build shipped a pointer instead of real content',
      );
    }
    if (name === 'release-manifest.json' && bytes.length < 50) {
      throw new Error('release-manifest.json looks like a placeholder (too small)');
    }

    // Per-platform checksum files from the matrix runners must never reach the
    // final release — the merged set needs one file that describes everything.
    if (/^SHA256SUMS\./.test(name) || /SHA256SUMS.*\.txt$/.test(name)) {
      throw new Error(
        `Leftover per-platform checksum file ${name} — run merge-manifests first, then ` +
          'generate the final SHA256SUMS.txt',
      );
    }

    lines.push(`${sha256(path)}  ${name}`);
  }

  if (lines.length === 0) throw new Error('No files to checksum');

  const body = `${lines.join('\n')}\n`;
  writeFileSync(join(dir, 'SHA256SUMS.txt'), body);

  process.stdout.write(`SHA256SUMS.txt written for ${lines.length} file(s):\n`);
  for (const line of lines) process.stdout.write(`  ${line.slice(0, 20)}… ${line.slice(66)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
