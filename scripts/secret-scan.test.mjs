#!/usr/bin/env node

/**
 * Secret-scanner regression tests (canaries).
 *
 * Canary values are constructed at runtime from fragments so no live-format
 * token is ever committed to source. They are unmistakably fake (repeated
 * characters) — the scanner must flag the *format*, and no provider could
 * mistake them for a real credential.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCANNER = new URL('./secret-scan.mjs', import.meta.url).pathname;

const FAKE = {
  githubPat: `ghp_${'A'.repeat(36)}`,
  fineGrainedPat: `github_pat_${'B'.repeat(50)}`,
  awsKey: `AKIA${'C'.repeat(16)}`,
  // Fragments: the assembled value is a literal PEM marker, but no
  // contiguous marker exists in this file's source.
  privateKey: `${'-----BEGIN '}RSA PRIVATE KEY-----`,
  slackWebhook: `https://hooks.slack.com/services/T${'1'.repeat(10)}/B${'1'.repeat(11)}/${'a'.repeat(40)}`,
  jwt: `eyJ${'D'.repeat(20)}.${'E'.repeat(20)}.${'F'.repeat(20)}`,
  secretEnv: `VARVE_API_TOKEN=${'G'.repeat(24)}`,
};

function runScanner(args, cwd) {
  try {
    execFileSync(process.execPath, [SCANNER, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { exit: 0, out: '' };
  } catch (err) {
    return { exit: err.status ?? 1, out: err.stdout + err.stderr };
  }
}

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'varve-secret-scan-'));
  execFileSync('git', ['init', '-q', '-b', 'test'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function assertClean(repoDir) {
  const { exit, out } = runScanner(['--staged'], repoDir);
  assert.equal(exit, 0, `expected clean, got: ${out}`);
}

function assertFinding(repoDir, expectRule) {
  const { exit, out } = runScanner(['--staged'], repoDir);
  assert.notEqual(exit, 0, 'expected scan failure for canary');
  assert.ok(out.includes(expectRule), `expected rule ${expectRule} in output: ${out}`);
}

function testStagedCanaryFails() {
  const repo = makeTempRepo();
  try {
    const file = join(repo, 'canary.txt');
    writeFileSync(file, `line one\n${FAKE.githubPat}\n`, 'utf8');
    execFileSync('git', ['add', 'canary.txt'], { cwd: repo });
    assertFinding(repo, 'github-pat');
  } finally {
    execFileSync('rm', ['-rf', repo]);
  }
}

function testPrivateKeyCanaryFails() {
  const repo = makeTempRepo();
  try {
    const file = join(repo, 'id_ed25519');
    writeFileSync(file, `${FAKE.privateKey}\n${'H'.repeat(64)}\n`, 'utf8');
    execFileSync('git', ['add', 'id_ed25519'], { cwd: repo });
    assertFinding(repo, 'private-key-block');
  } finally {
    execFileSync('rm', ['-rf', repo]);
  }
}

function testEnvSecretCanaryFails() {
  const repo = makeTempRepo();
  try {
    const file = join(repo, 'script.sh');
    writeFileSync(file, `#!/bin/sh\n${FAKE.secretEnv}\n`, 'utf8');
    execFileSync('git', ['add', 'script.sh'], { cwd: repo });
    assertFinding(repo, 'env-style-secret-key');
  } finally {
    execFileSync('rm', ['-rf', repo]);
  }
}

function testSecretReferenceDoesNotFail() {
  const repo = makeTempRepo();
  try {
    const file = join(repo, 'workflow.yml');
    writeFileSync(
      file,
      `name: Test\non: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    env:\n      TOKEN: \${{ secrets.REAL_SECRET }}\n    steps:\n      - run: echo "\${TOKEN}"\n`,
      'utf8',
    );
    execFileSync('git', ['add', 'workflow.yml'], { cwd: repo });
    assertClean(repo);
  } finally {
    execFileSync('rm', ['-rf', repo]);
  }
}

function testAllowlistedFixturePathPasses() {
  const repo = makeTempRepo();
  try {
    const dir = join(repo, 'packages/crash/src');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'redactFixtures.ts');
    writeFileSync(
      file,
      `export const SECRET_FIXTURES = { apiKeyInText: 'api_key=sk-1234567890abcdef' };\n`,
      'utf8',
    );
    execFileSync('git', ['add', '.'], { cwd: repo });
    assertClean(repo);
  } finally {
    execFileSync('rm', ['-rf', repo]);
  }
}

function testStagedOnlyScanIgnoresCommittedCanary() {
  const repo = makeTempRepo();
  try {
    const file = join(repo, 'already-committed.txt');
    writeFileSync(file, FAKE.githubPat, 'utf8');
    execFileSync('git', ['add', file], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'canary history'], { cwd: repo });
    const clean = join(repo, 'clean.txt');
    writeFileSync(clean, 'nothing suspicious\n', 'utf8');
    execFileSync('git', ['add', clean], { cwd: repo });
    assertClean(repo);
  } finally {
    execFileSync('rm', ['-rf', repo]);
  }
}

testStagedCanaryFails();
testPrivateKeyCanaryFails();
testEnvSecretCanaryFails();
testSecretReferenceDoesNotFail();
testAllowlistedFixturePathPasses();
testStagedOnlyScanIgnoresCommittedCanary();

console.log('secret-scan tests passed (6 canaries).');
