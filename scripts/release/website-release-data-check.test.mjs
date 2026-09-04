import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateWebsiteReleaseData } from './website-release-data-check.mjs';

test('accepts the committed published release data', () => {
  const data = JSON.parse(readFileSync('apps/website/src/data/release-manifest.json', 'utf8'));
  assert.deepEqual(validateWebsiteReleaseData(data), []);
});

test('accepts the honest no-release state', () => {
  assert.deepEqual(
    validateWebsiteReleaseData({
      schemaVersion: 2,
      hasRelease: false,
      version: null,
      tag: null,
      releaseDate: null,
      platforms: {},
    }),
    [],
  );
});

test('rejects malformed release data before website deployment', () => {
  const errors = validateWebsiteReleaseData({
    schemaVersion: 2,
    hasRelease: true,
    version: '0.2.1',
    tag: 'v0.2.0',
    integrity: 'unverified',
    platforms: {},
  });
  assert.ok(errors.some((error) => error.includes('tag')));
  assert.ok(errors.some((error) => error.includes('integrity')));
  assert.ok(errors.some((error) => error.includes('at least one artifact')));
});
