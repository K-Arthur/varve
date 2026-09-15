#!/usr/bin/env node
/**
 * Post-build verification of a release directory.
 *
 * Runs against the *exact* files that will be uploaded, after they have been
 * copied and renamed — not against the build tree. The distinction matters: a
 * truncated copy, a rename that collided, or a manifest merged from a stale
 * partial run all produce a directory that looks right and hashes wrong.
 *
 * Usage:
 *   node scripts/release/verify-artifacts.mjs --dir dist/release [--expect-version 0.1.0]
 *
 * Exits non-zero on any mismatch. Intended as the gate between "artifacts built"
 * and "draft release created".
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArchitecture, targetFor } from './targets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Below this, an "installer" is a build failure that produced a stub. */
const MIN_PLAUSIBLE_ARTIFACT_BYTES = 1_000_000;

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
  const dir = resolve(repoRoot, args.dir ?? 'dist/release');
  const problems = [];
  const notes = [];

  if (!existsSync(dir)) throw new Error(`Release directory not found: ${dir}`);

  const manifestPath = join(dir, 'release-manifest.json');
  const sumsPath = join(dir, 'SHA256SUMS.txt');
  if (!existsSync(manifestPath)) throw new Error(`Missing release-manifest.json in ${dir}`);
  if (!existsSync(sumsPath)) throw new Error(`Missing SHA256SUMS.txt in ${dir}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const expectVersion = args['expect-version'] ?? manifest.version;

  if (manifest.version !== expectVersion) {
    problems.push(`Manifest version '${manifest.version}' != expected '${expectVersion}'`);
  }
  if (manifest.version === '0.0.0') {
    problems.push('Manifest version is the 0.0.0 placeholder, not a release version');
  }

  // Parse SHA256SUMS.txt into a lookup so the two integrity sources can be
  // cross-checked against each other as well as against the bytes on disk.
  const sums = new Map();
  for (const line of readFileSync(sumsPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^([0-9a-f]{64})\s\s(.+)$/);
    if (!match) {
      problems.push(`Malformed line in SHA256SUMS.txt: ${line}`);
      continue;
    }
    sums.set(match[2], match[1]);
  }

  // Every file in the release directory — installers, SBOMs, the manifest —
  // must be described by SHA256SUMS.txt and match its hash. The checksum file
  // is the last thing generated before upload; anything it does not cover is
  // a file that would ship unverified.
  const onDisk = new Set(
    readdirSync(dir).filter((f) => f !== 'release-manifest.json' && f !== 'SHA256SUMS.txt'),
  );

  for (const artifact of manifest.artifacts) {
    const path = join(dir, artifact.filename);

    const architecture = normalizeArchitecture(artifact.arch);
    targetFor(artifact.os, architecture);
    if (!artifact.filename.includes(`-${architecture}.`)) {
      problems.push(
        `${artifact.filename}: manifest architecture ${architecture} disagrees with filename`,
      );
    }

    if (!existsSync(path)) {
      problems.push(`Manifest lists '${artifact.filename}' but it is not in ${dir}`);
      continue;
    }
    onDisk.delete(artifact.filename);

    const actualHash = sha256(path);
    if (actualHash !== artifact.sha256) {
      problems.push(
        `${artifact.filename}: manifest sha256 ${artifact.sha256.slice(0, 16)}… ` +
          `but file hashes to ${actualHash.slice(0, 16)}…`,
      );
    }

    const declaredSum = sums.get(artifact.filename);
    if (!declaredSum) {
      problems.push(`${artifact.filename}: absent from SHA256SUMS.txt`);
    } else if (declaredSum !== actualHash) {
      problems.push(`${artifact.filename}: SHA256SUMS.txt disagrees with the file on disk`);
    }

    const actualSize = statSync(path).size;
    if (actualSize !== artifact.sizeBytes) {
      problems.push(
        `${artifact.filename}: manifest size ${artifact.sizeBytes} != actual ${actualSize}`,
      );
    }
    if (actualSize < MIN_PLAUSIBLE_ARTIFACT_BYTES) {
      problems.push(
        `${artifact.filename}: only ${actualSize} bytes — a real installer is never this small`,
      );
    }

    // The filename is a contract with the download page and the checksum file;
    // if the version drifted out of it, links will 404 after publication.
    if (!artifact.filename.includes(`-${expectVersion}-`)) {
      problems.push(
        `${artifact.filename}: filename does not contain expected version '${expectVersion}'`,
      );
    }
  }

  for (const orphan of onDisk) {
    // SBOMs and the manifest itself are legitimate non-installer files, but
    // they must still be covered by SHA256SUMS.txt with matching hashes.
    const declaredSum = sums.get(orphan);
    if (!declaredSum) {
      problems.push(
        `'${orphan}' is present in ${dir} but absent from SHA256SUMS.txt — it would ship ` +
          'without an integrity record',
      );
      continue;
    }
    const actualHash = sha256(join(dir, orphan));
    if (declaredSum !== actualHash) {
      problems.push(
        `'${orphan}': SHA256SUMS.txt hash ${declaredSum.slice(0, 16)}… does not match ` +
          `the file on disk (${actualHash.slice(0, 16)}…)`,
      );
    }
  }

  // Anything SHA256SUMS.txt mentions must exist on disk (a phantom entry makes
  // `sha256sum -c` fail for users — verify it here, on the real bytes).
  for (const [name] of sums) {
    if (name === 'SHA256SUMS.txt') continue;
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push(`SHA256SUMS.txt lists '${name}' which is not a file in ${dir}`);
    }
  }

  // Signing claims must never be aspirational — an artifact labelled signed that
  // is not signed is worse than an honestly unsigned one.
  if (manifest.signed === true) {
    notes.push('Manifest claims signed=true — verify signatures independently before publishing.');
  } else {
    notes.push('Manifest declares signed=false. Downloads must be presented as unsigned.');
  }

  const platforms = [...new Set(manifest.artifacts.map((a) => `${a.os}/${a.arch}`))];
  process.stdout.write(`Verified ${manifest.artifacts.length} artifact(s) for ${expectVersion}\n`);
  process.stdout.write(`  platforms: ${platforms.join(', ')}\n`);
  for (const note of notes) process.stdout.write(`  note: ${note}\n`);

  if (problems.length > 0) {
    process.stderr.write('\nArtifact verification FAILED:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('\nAll artifacts verified.\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
