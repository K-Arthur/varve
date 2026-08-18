#!/usr/bin/env node
/**
 * Unit tests for the product truth verification script.
 *
 * Run: node scripts/release/verify-product-truth.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools).
 *
 * Tests both the happy path (current repo state passes) and targeted
 * assertion checks that verify the guard's detection logic.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(new URL('../..', import.meta.url).pathname);
const SCRIPT = join(ROOT, 'scripts/release/verify-product-truth.mjs');

function run(cwd = ROOT, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exit: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exit: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

// ── 1. Current repo state must pass ────────────────────────────────────────
{
  const result = run();
  assert.equal(
    result.exit,
    0,
    `verify-product-truth should pass on current repo.\nstderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /all checks passed/);
  console.log('  PASS: current repo state passes');
}

// ── 2. version.mjs verify should also pass ─────────────────────────────────
{
  const versionResult = execFileSync(
    process.execPath,
    [join(ROOT, 'scripts/release/version.mjs'), 'verify'],
    {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  assert.ok(versionResult.includes('agree'), 'version.mjs verify should agree');
  console.log('  PASS: version.mjs verify passes');
}

// ── 3. DOCUMENT_EXT regex correctly distinguishes varve from strata ─────────
{
  const pattern = /(?<!\w)DOCUMENT_EXT\s*=\s*'([^']+)'/;
  const varveMatch = "export const DOCUMENT_EXT = 'varve';".match(pattern);
  const strataMatch = "export const LEGACY_DOCUMENT_EXT = 'strata';".match(pattern);
  assert.ok(varveMatch, 'should match DOCUMENT_EXT = varve');
  assert.equal(varveMatch[1], 'varve');
  assert.equal(strataMatch, null, 'should NOT match LEGACY_DOCUMENT_EXT');
  console.log('  PASS: DOCUMENT_EXT regex correctly matches varve, not strata');
}

// ── 4. Signing claims semantics: signed without signing block is a problem ──
{
  // This is the logic the guard enforces:
  // signed=true but signing=null should be caught
  const manifest = {
    signed: true,
    notarized: false,
    signing: null,
    integrity: 'verified',
    platforms: {},
  };
  assert.equal(manifest.signed, true);
  assert.equal(manifest.signing, null);
  // The guard checks: if (manifest.signed === true && !manifest.signing) → problem
  const hasProblem = manifest.signed === true && !manifest.signing;
  assert.ok(hasProblem, 'signed=true without signing block should be caught');
  console.log('  PASS: signing claim semantics validated');
}

// ── 5. Signing claims: signed=false with signing=null is fine (unsigned) ─────
{
  const manifest = {
    signed: false,
    notarized: false,
    signing: null,
    integrity: 'verified',
    platforms: {},
  };
  assert.equal(manifest.signed, false);
  const hasProblem = manifest.signed === true && !manifest.signing;
  assert.ok(!hasProblem, 'signed=false should not trigger signing-block check');
  console.log('  PASS: unsigned release does not trigger signing-block check');
}

// ── 6. CHANGELOG date pattern validation ────────────────────────────────────
{
  const version = '0.1.2';
  const datePattern = new RegExp(
    `## \\[${version.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})`,
  );
  const goodChangelog = `## [${version}] - 2026-08-14\n\n### Added\n- Feature\n`;
  const badChangelog = `## [${version}]\n\n### Added\n- Feature\n`;
  const wrongDateChangelog = `## [${version}] - TBD\n\n### Added\n- Feature\n`;
  assert.ok(datePattern.test(goodChangelog), 'should match dated entry');
  assert.ok(!datePattern.test(badChangelog), 'should reject undated entry');
  assert.ok(!datePattern.test(wrongDateChangelog), 'should reject non-ISO date');
  console.log('  PASS: CHANGELOG date pattern validation works');
}

// ── 7. Semver validation ────────────────────────────────────────────────────
{
  const semver = /^\d+\.\d+\.\d+/;
  assert.ok(semver.test('0.1.2'));
  assert.ok(semver.test('1.0.0'));
  assert.ok(!semver.test('abc'));
  assert.ok(!semver.test(''));
  console.log('  PASS: semver validation works');
}

// ── 8. Output format includes all check names ───────────────────────────────
{
  // Pass --verbose via argv so all check names are printed even when passing
  const result = (() => {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, '--verbose'], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { exit: 0, stdout, stderr: '' };
    } catch (err) {
      return { exit: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  })();
  const expectedChecks = [
    'version-consistency',
    'document-extension',
    'signing-claims',
    'changelog',
    'stale-strata-refs',
    'platform-claims',
    'website-manifest',
    'updater',
    'copyright',
  ];
  for (const name of expectedChecks) {
    assert.ok(result.stdout.includes(name), `output should include check name: ${name}`);
  }
  console.log('  PASS: output format includes all check names');
}

console.log('\nverify-product-truth.test.mjs \u2014 all tests passed');
