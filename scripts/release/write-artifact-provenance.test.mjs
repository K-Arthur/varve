#!/usr/bin/env node

/** Exact-SHA sidecar generation tests for resumable release artifacts. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArtifactProvenance } from './write-artifact-provenance.mjs';

const dir = mkdtempSync(join(tmpdir(), 'varve-artifact-provenance-'));
const expected = {
  version: '0.3.0',
  commitSha: 'a'.repeat(40),
  policyHash: 'b'.repeat(64),
};

try {
  const filename = 'Varve-0.3.0-linux-x86_64.AppImage';
  const bytes = Buffer.from('exact release bytes');
  writeFileSync(join(dir, filename), bytes);
  writeFileSync(
    join(dir, 'release-manifest.json'),
    `${JSON.stringify({
      version: expected.version,
      artifacts: [{ filename, os: 'linux', arch: 'x86_64' }],
    })}\n`,
  );

  const outputs = writeArtifactProvenance({ dir, ...expected, platform: 'linux-x86_64' });
  assert.equal(outputs.length, 1);
  const evidence = JSON.parse(readFileSync(outputs[0], 'utf8'));
  assert.deepEqual(evidence, {
    schema: 1,
    ...expected,
    platform: 'linux-x86_64',
    artifact: filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });

  assert.throws(
    () => writeArtifactProvenance({ dir, ...expected, platform: 'linux-armv7' }),
    /unsupported release platform/,
  );
  assert.throws(
    () => writeArtifactProvenance({ dir, ...expected, platform: 'windows-x86_64' }),
    /no collected artifact/,
  );
  console.log('artifact provenance tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
