#!/usr/bin/env node

/** Exact-SHA release-artifact reuse and path-safety tests. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectResumableArtifacts,
  validateReusableArtifact,
  writeFinalManifest,
} from './resume.mjs';

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

  console.log('release resume tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
