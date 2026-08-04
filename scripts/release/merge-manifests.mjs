#!/usr/bin/env node
/**
 * Merge the per-runner release manifests produced by the bundle matrix into one
 * manifest plus one checksum file describing the complete release.
 *
 * Each runner writes a manifest covering only its own platform. Rather than
 * trusting those and concatenating, this rebuilds both files by re-hashing every
 * artifact that actually landed in the output directory. The manifests are used
 * only as the source of *metadata* (os, arch, format, label) — the hashes and
 * sizes always come from the bytes on disk, so a truncated download-artifact
 * step cannot smuggle a stale hash into the release.
 *
 * Usage:
 *   node scripts/release/merge-manifests.mjs --staged staged --out dist/release
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function humanSize(bytes) {
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stagedDir = resolve(repoRoot, args.staged ?? 'staged');
  const outDir = resolve(repoRoot, args.out ?? 'dist/release');

  // Collect metadata from every per-runner manifest.
  const metadata = new Map();
  let version;
  for (const path of walk(stagedDir)) {
    if (!path.endsWith('release-manifest.json')) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf-8'));
    version ??= manifest.version;
    if (manifest.version !== version) {
      throw new Error(
        `Manifest version mismatch across runners: '${version}' vs '${manifest.version}'. ` +
          'One runner built a different commit than the others.',
      );
    }
    for (const artifact of manifest.artifacts ?? []) {
      metadata.set(artifact.filename, artifact);
    }
  }

  if (!version) throw new Error(`No release-manifest.json found under ${stagedDir}`);

  // Re-derive hashes and sizes from the merged output directory.
  const artifacts = [];
  const unknown = [];
  for (const entry of readdirSync(outDir)) {
    if (entry === 'release-manifest.json' || entry === 'SHA256SUMS.txt') continue;
    if (entry.endsWith('.cdx.json')) continue; // SBOM is attached, not an installer

    const path = join(outDir, entry);
    if (!statSync(path).isFile()) continue;

    const meta = metadata.get(entry);
    if (!meta) {
      unknown.push(entry);
      continue;
    }

    const bytes = readFileSync(path);
    const size = bytes.length;
    artifacts.push({
      ...meta,
      sizeBytes: size,
      size: humanSize(size),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  if (unknown.length > 0) {
    throw new Error(
      `Files in ${outDir} that no runner manifest describes: ${unknown.join(', ')}\n` +
        'Refusing to publish an artifact of unknown provenance.',
    );
  }
  if (artifacts.length === 0) {
    throw new Error(`No artifacts found in ${outDir}`);
  }

  artifacts.sort((a, b) => a.filename.localeCompare(b.filename));

  const manifest = {
    schemaVersion: 1,
    version,
    generatedAt: new Date().toISOString(),
    signed: false,
    notarized: false,
    artifacts,
  };
  writeFileSync(join(outDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(outDir, 'SHA256SUMS.txt'),
    `${artifacts.map((a) => `${a.sha256}  ${a.filename}`).join('\n')}\n`,
  );

  process.stdout.write(`Merged ${artifacts.length} artifact(s) for ${version}:\n`);
  for (const a of artifacts) {
    process.stdout.write(`  ${a.filename.padEnd(46)} ${a.size.padStart(9)}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
