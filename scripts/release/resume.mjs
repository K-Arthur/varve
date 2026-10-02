#!/usr/bin/env node

/**
 * Safe release-artifact resume primitives.
 *
 * A reused artifact must carry a sidecar provenance record.  Final checksums
 * are regenerated only after every requested platform has an exact identity
 * match and the bytes still hash to the recorded digest.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RELEASE_TARGETS = Object.freeze([
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
  'windows-aarch64',
  'macos-aarch64',
]);

const SHA256 = /^[0-9a-f]{64}$/;

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function validateReusableArtifact(metadata, expected) {
  const errors = [];
  if (metadata?.schema !== 1) errors.push('provenance schema must be 1');
  for (const field of ['version', 'commitSha', 'policyHash']) {
    if (metadata?.[field] !== expected?.[field]) errors.push(`${field} mismatch`);
  }
  if (expected?.platform && metadata?.platform !== expected.platform)
    errors.push('platform mismatch');
  if (!RELEASE_TARGETS.includes(metadata?.platform)) {
    errors.push('platform is invalid');
  }
  if (
    typeof metadata?.artifact !== 'string' ||
    !metadata.artifact ||
    metadata.artifact.includes('\0') ||
    metadata.artifact === '.' ||
    metadata.artifact === '..' ||
    metadata.artifact.includes('/') ||
    metadata.artifact.includes('\\')
  ) {
    errors.push('artifact name is invalid');
  }
  if (!metadata?.sha256 || !SHA256.test(metadata.sha256)) errors.push('missing sha256');
  return errors;
}

export function collectResumableArtifacts(dir, expected, { requiredPlatforms = [] } = {}) {
  const entries = [];
  const errors = [];
  let files;
  try {
    files = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return { ok: false, entries, errors: [`release directory unavailable: ${error.message}`] };
  }
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.provenance.json')) continue;
    const metadataPath = join(dir, entry.name);
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    } catch {
      errors.push(`${entry.name}: invalid provenance JSON`);
      continue;
    }
    const identityErrors = validateReusableArtifact(metadata, expected);
    const artifactName = typeof metadata.artifact === 'string' ? metadata.artifact : '';
    if (!identityErrors.includes('artifact name is invalid')) {
      const artifactPath = resolve(dir, artifactName);
      const relativePath = relative(resolve(dir), artifactPath);
      const escaped =
        !artifactName ||
        isAbsolute(artifactName) ||
        relativePath === '..' ||
        relativePath.startsWith(`..${sep}`);
      if (escaped || !lstatSync(artifactPath, { throwIfNoEntry: false })?.isFile()) {
        identityErrors.push('artifact file is missing');
      } else if (metadata.sha256 !== digest(artifactPath)) {
        identityErrors.push('artifact SHA-256 does not match provenance');
      }
    }
    if (identityErrors.length) {
      errors.push(`${entry.name}: ${identityErrors.join(', ')}`);
    } else if (entries.some((candidate) => candidate.metadata.artifact === metadata.artifact)) {
      errors.push(`${entry.name}: duplicate provenance for artifact ${metadata.artifact}`);
    } else {
      entries.push({ metadata, path: resolve(dir, artifactName) });
    }
  }
  for (const platform of requiredPlatforms) {
    if (!entries.some((entry) => entry.metadata.platform === platform)) {
      errors.push(`missing verified artifact for platform ${platform}`);
    }
  }
  return { ok: errors.length === 0, entries, errors };
}

export function writeFinalManifest(dir, result, { version, commitSha, policyHash } = {}) {
  if (!result.ok) throw new Error(`cannot write final manifest: ${result.errors.join('; ')}`);
  const path = join(dir, 'release-manifest.json');
  let collected;
  try {
    collected = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(`cannot read collected manifest: ${error.message}`);
  }
  // The real collector carries format, architecture, size and signing data.
  // Keep that contract intact rather than replacing it with sidecar-only rows
  // that downstream verification and the website cannot consume.
  if (collected) {
    if (collected.version !== version) throw new Error('collected manifest version mismatch');
    const byName = new Map(result.entries.map(({ metadata }) => [metadata.artifact, metadata]));
    if (collected.artifacts?.length !== byName.size)
      throw new Error('collected manifest and verified provenance artifact sets differ');
    const seen = new Set();
    for (const artifact of collected.artifacts) {
      const name = artifact.filename ?? artifact.artifact;
      const metadata = byName.get(name);
      if (!metadata || seen.has(name))
        throw new Error(`unverified or duplicate collected artifact '${name}'`);
      seen.add(name);
      if ((artifact.platform ?? `${artifact.os}-${artifact.arch}`) !== metadata.platform)
        throw new Error(`collected platform mismatch for '${name}'`);
      if (artifact.sha256 !== metadata.sha256)
        throw new Error(`collected SHA-256 mismatch for '${name}'`);
    }
  }
  const manifest = {
    ...collected,
    schema: 1,
    version,
    commitSha,
    policyHash,
    artifacts:
      collected?.artifacts ??
      result.entries.map(({ metadata }) => ({
        platform: metadata.platform,
        artifact: metadata.artifact,
        sha256: metadata.sha256,
      })),
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return path;
}
