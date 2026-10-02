#!/usr/bin/env node

/** Exact-SHA release-artifact reuse and path-safety tests. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectResumableArtifacts,
  validateReusableArtifact,
  writeFinalManifest,
} from './resume.mjs';
import { writeArtifactProvenance } from './write-artifact-provenance.mjs';

const dir = mkdtempSync(join(tmpdir(), 'varve-release-resume-'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expected = { version: '0.3.0', commitSha: 'a'.repeat(40), policyHash: 'b'.repeat(64) };

function add(platform, contents) {
  const artifact = `Varve-${expected.version}-${platform}.bin`;
  const bytes = Buffer.from(contents);
  writeFileSync(join(dir, artifact), bytes);
  writeFileSync(
    join(dir, `${artifact}.provenance.json`),
    `${JSON.stringify({
      schema: 1,
      ...expected,
      platform,
      artifact,
      sha256: sha256(bytes),
    })}\n`,
  );
}

try {
  add('linux-x86_64', 'linux');
  add('windows-x86_64', 'windows');
  const partial = collectResumableArtifacts(dir, expected, {
    requiredPlatforms: ['linux-x86_64', 'windows-x86_64', 'macos-aarch64'],
  });
  assert.equal(partial.ok, false);
  assert.ok(partial.errors.some((error) => error.includes('macos-aarch64')));

  add('macos-aarch64', 'macos');
  const complete = collectResumableArtifacts(dir, expected, {
    requiredPlatforms: ['linux-x86_64', 'windows-x86_64', 'macos-aarch64'],
  });
  assert.equal(complete.ok, true);
  const manifestPath = writeFinalManifest(dir, complete, expected);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.commitSha, expected.commitSha);
  assert.equal(manifest.artifacts.length, 3);
  assert.equal(writeFinalManifest(dir, complete, expected), manifestPath, 'resume is idempotent');

  // A byte mutation or a source/policy mismatch invalidates reuse; no mixed
  // commit artifact can enter a final manifest.
  const mutated = join(dir, 'Varve-0.3.0-linux-x86_64.bin');
  writeFileSync(mutated, 'tampered');
  const badBytes = collectResumableArtifacts(dir, expected, { requiredPlatforms: [] });
  assert.equal(badBytes.ok, false);
  assert.ok(badBytes.errors.some((error) => error.includes('SHA-256')));
  assert.ok(
    validateReusableArtifact(
      { ...expected, platform: 'linux-x86_64', artifact: '../escape', sha256: 'c'.repeat(64) },
      expected,
    ).some((error) => error.includes('artifact name')),
  );
  const wrongCommit = collectResumableArtifacts(
    dir,
    { ...expected, commitSha: 'd'.repeat(40) },
    { requiredPlatforms: [] },
  );
  assert.equal(wrongCommit.ok, false);
  assert.ok(wrongCommit.errors.some((error) => error.includes('commitSha mismatch')));

  // Sidecar paths cannot escape the release directory.
  writeFileSync(
    join(dir, 'unsafe.provenance.json'),
    JSON.stringify({
      schema: 1,
      ...expected,
      platform: 'linux-x86_64',
      artifact: '../outside.bin',
      sha256: 'd'.repeat(64),
    }),
  );
  const unsafe = collectResumableArtifacts(dir, expected, { requiredPlatforms: [] });
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.errors.some((error) => error.includes('artifact name is invalid')));

  const invalidPlatform = join(dir, 'invalid-platform.provenance.json');
  writeFileSync(
    invalidPlatform,
    JSON.stringify({
      schema: 1,
      ...expected,
      platform: 'linux-armv7',
      artifact: 'missing.bin',
      sha256: 'e'.repeat(64),
    }),
  );
  const invalid = collectResumableArtifacts(dir, expected, { requiredPlatforms: [] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes('platform is invalid')));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Exercise the real writer -> resume -> installer-verification contract. Linux
// has three formats for one platform, and the collected metadata must survive.
const multiFormatDir = mkdtempSync(join(tmpdir(), 'varve-release-resume-formats-'));
try {
  const artifacts = ['AppImage', 'deb', 'rpm'].map((extension) => {
    const filename = `Varve-${expected.version}-linux-x86_64.${extension}`;
    const bytes = Buffer.alloc(1_000_000, extension);
    writeFileSync(join(multiFormatDir, filename), bytes);
    return {
      filename,
      os: 'linux',
      arch: 'x86_64',
      format: extension.toLowerCase(),
      label: extension,
      sizeBytes: bytes.length,
      size: '1.0 MB',
      sha256: sha256(bytes),
    };
  });
  const collected = {
    schemaVersion: 1,
    version: expected.version,
    signed: false,
    notarized: false,
    artifacts,
  };
  const manifestPath = join(multiFormatDir, 'release-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(collected));
  writeArtifactProvenance({ dir: multiFormatDir, ...expected, platform: 'linux-x86_64' });
  const result = collectResumableArtifacts(multiFormatDir, expected, {
    requiredPlatforms: ['linux-x86_64'],
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.entries.length, 3);
  writeFinalManifest(multiFormatDir, result, expected);
  const resumed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(resumed.artifacts, collected.artifacts);
  assert.equal(resumed.schemaVersion, 1);
  assert.equal(resumed.signed, false);
  assert.equal(resumed.commitSha, expected.commitSha);
  execFileSync(process.execPath, [
    'scripts/release/generate-final-checksums.mjs',
    '--dir',
    multiFormatDir,
  ]);
  execFileSync(process.execPath, [
    'scripts/release/verify-artifacts.mjs',
    '--dir',
    multiFormatDir,
    '--expect-version',
    expected.version,
  ]);
  const altered = {
    ...collected,
    artifacts: [{ ...artifacts[0], sha256: 'e'.repeat(64) }, ...artifacts.slice(1)],
  };
  writeFileSync(manifestPath, JSON.stringify(altered));
  assert.throws(() => writeFinalManifest(multiFormatDir, result, expected), /SHA-256 mismatch/);
  assert.deepEqual(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    altered,
    'a refusal preserves failure evidence',
  );
  writeFileSync(
    join(multiFormatDir, 'duplicate.provenance.json'),
    readFileSync(join(multiFormatDir, `${artifacts[0].filename}.provenance.json`)),
  );
  assert.ok(
    collectResumableArtifacts(multiFormatDir, expected).errors.some((error) =>
      error.includes('duplicate provenance for artifact'),
    ),
  );
  rmSync(join(multiFormatDir, 'duplicate.provenance.json'));
  // Creating file symlinks requires privileges on Windows; exercise the real
  // filesystem refusal where file symlinks are available without elevation.
  if (process.platform !== 'win32') {
    rmSync(join(multiFormatDir, artifacts[0].filename));
    symlinkSync(
      join(multiFormatDir, artifacts[1].filename),
      join(multiFormatDir, artifacts[0].filename),
    );
    assert.ok(
      collectResumableArtifacts(multiFormatDir, expected).errors.some((error) =>
        error.includes('artifact file is missing'),
      ),
      'a symlink cannot stand in for verified artifact bytes',
    );
  }
} finally {
  rmSync(multiFormatDir, { recursive: true, force: true });
}

console.log('release resume tests passed');
