#!/usr/bin/env node

/**
 * Regression tests for the visual-diff manifest builder.
 *
 * The bug these guard against: the builder scanned only the immediate
 * children of test-results/. When playwright.config.ts began isolating each
 * execution under its own `outputDir` (`test-results/run-<pid>-<port>/`), the
 * diff images moved one level deeper and the builder reported zero failures
 * on a genuinely failing run — the visual job uploaded an empty manifest as
 * its only evidence.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/build-visual-diff-manifest.mjs');
// The builder resolves test-results/ relative to the repo, so the fixture has
// to live there. test-results/ is gitignored; the unique name keeps this from
// colliding with a real run or a concurrent agent's output.
const FIXTURE_ROOT = join(ROOT, 'test-results', `__manifest-test-${process.pid}`);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** A 1x1 PNG — content is irrelevant, only the filenames drive the builder. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function writeAttempt(dir, fixture) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fixture}-diff.png`), PNG);
  writeFileSync(join(dir, `${fixture}-actual.png`), PNG);
}

function runBuilder() {
  const out = mkdtempSync(join(tmpdir(), 'varve-vdiff-'));
  execFileSync(process.execPath, [SCRIPT, out], { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
  return { out, manifest: JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf-8')) };
}

console.log('build-visual-diff-manifest regression tests\n');

try {
  // Nested exactly like a real isolated run: run-<pid>-<port>/<test-dir>/
  writeAttempt(
    join(FIXTURE_ROOT, 'run-1234-1420', 'visual-replay-probe-fixture'),
    'probe-fixture-1x',
  );

  const { manifest } = runBuilder();
  const entry = manifest.entries.find((e) => e.name === 'probe-fixture-1x');

  test('finds diff images nested under a per-run outputDir', () => {
    assert.ok(entry, 'nested fixture must appear in the manifest');
  });

  test('records the diff and current images for the fixture', () => {
    assert.ok(entry?.diff, 'diff image must be recorded');
    assert.ok(entry?.current, 'current image must be recorded');
  });

  // A retry of the same fixture: the settled (highest) attempt wins.
  writeAttempt(
    join(FIXTURE_ROOT, 'run-1234-1420', 'visual-replay-probe-fixture-retry2'),
    'probe-fixture-1x',
  );

  const second = runBuilder();
  const forFixture = second.manifest.entries.filter((e) => e.name === 'probe-fixture-1x');

  test('collapses retries of one fixture to a single entry', () => {
    assert.equal(forFixture.length, 1, `expected 1 entry, got ${forFixture.length}`);
  });

  test('keeps the final attempt rather than the first', () => {
    assert.match(forFixture[0].testDir, /retry2$/);
  });

  test('copies no images for the superseded attempt', () => {
    const orphans = readdirSync(second.out).filter(
      (f) => f.includes('probe-fixture') && !f.includes('retry2') && f.endsWith('.png'),
    );
    assert.equal(orphans.length, 0, `unexpected orphan images: ${orphans.join(', ')}`);
  });
} finally {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
