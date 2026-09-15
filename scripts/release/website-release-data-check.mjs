#!/usr/bin/env node

/**
 * Validate the committed website release-data shape without contacting GitHub.
 *
 * This is intentionally smaller than the release-integrity verifier: the
 * release workflow verifies the published bytes, while this check protects
 * the Pages workflow from rendering malformed committed release state.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateWebsiteReleaseData(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['release data must be an object'];
  }
  if (data.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (typeof data.hasRelease !== 'boolean') errors.push('hasRelease must be boolean');

  if (data.hasRelease === false) {
    for (const field of ['version', 'tag', 'releaseDate']) {
      if (data[field] !== null) errors.push(`no-release state must set ${field} to null`);
    }
    if (data.platforms && Object.keys(data.platforms).length > 0) {
      errors.push('no-release state must not contain platform downloads');
    }
    return errors;
  }

  if (typeof data.version !== 'string' || !VERSION.test(data.version)) {
    errors.push('published release must contain a valid semver version');
  }
  if (typeof data.tag !== 'string' || data.tag !== `v${data.version}`) {
    errors.push('published release tag must be v<version>');
  }
  if (typeof data.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.releaseDate)) {
    errors.push('published release must contain an ISO releaseDate');
  }
  if (data.integrity !== 'verified') errors.push('published release integrity must be verified');
  if (typeof data.releaseUrl !== 'string' || !data.releaseUrl.startsWith('https://')) {
    errors.push('published release must contain an HTTPS releaseUrl');
  }
  if (!data.platforms || typeof data.platforms !== 'object') {
    errors.push('published release must contain platform downloads');
    return errors;
  }

  const filenames = new Set();
  let artifactCount = 0;
  for (const [os, artifacts] of Object.entries(data.platforms)) {
    if (!Array.isArray(artifacts)) {
      errors.push(`${os} platform data must be an array`);
      continue;
    }
    for (const artifact of artifacts) {
      artifactCount += 1;
      if (!artifact || typeof artifact !== 'object') {
        errors.push(`${os} contains a non-object artifact`);
        continue;
      }
      if (artifact.os !== os) errors.push(`${os} artifact has mismatched os ${artifact.os}`);
      if (
        typeof artifact.filename !== 'string' ||
        !artifact.filename ||
        filenames.has(artifact.filename)
      ) {
        errors.push(`${os} contains a missing or duplicate filename`);
      } else {
        filenames.add(artifact.filename);
      }
      if (!SHA256.test(String(artifact.sha256 ?? ''))) {
        errors.push(`${os}/${artifact.filename ?? '(unknown)'} has an invalid sha256`);
      }
      if (!Number.isFinite(Number(artifact.sizeBytes)) || Number(artifact.sizeBytes) <= 0) {
        errors.push(`${os}/${artifact.filename ?? '(unknown)'} has an invalid sizeBytes`);
      }
      if (typeof artifact.url !== 'string' || !artifact.url.startsWith('https://')) {
        errors.push(`${os}/${artifact.filename ?? '(unknown)'} has no HTTPS download URL`);
      }
    }
  }
  if (artifactCount === 0) errors.push('published release must advertise at least one artifact');
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const file =
    fileIndex === -1
      ? join(ROOT, 'apps/website/src/data/release-manifest.json')
      : resolve(ROOT, args[fileIndex + 1]);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateWebsiteReleaseData(data);
  if (errors.length) throw new Error(`${file}:\n- ${errors.join('\n- ')}`);
  console.log(`Website release data valid: ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`website release-data check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
