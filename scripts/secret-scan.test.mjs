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

// ── Artifact scans (--dir) and the trust-boundary canary ──────────────────

function makeArtifactDir() {
  return mkdtempSync(join(tmpdir(), 'varve-artifact-scan-'));
}

function assertArtifactFinding(dir, expectRule, extraArgs = []) {
  const { exit, out } = runScanner(['--dir', dir, ...extraArgs], process.cwd());
  assert.notEqual(exit, 0, `expected artifact scan failure, got: ${out}`);
  assert.ok(out.includes(expectRule), `expected rule ${expectRule} in output: ${out}`);
}

function testArtifactDirCatchesCredentialShapedContent() {
  const dir = makeArtifactDir();
  try {
    writeFileSync(join(dir, 'bundle.js'), `const k = "${FAKE.awsKey}";\n`, 'utf8');
    assertArtifactFinding(dir, 'aws-access-key');
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

function testArtifactScanIgnoresBinaries() {
  const dir = makeArtifactDir();
  try {
    // Binary extensions are skipped by design (entropy scans on binaries
    // produce noise; binary strings get their own forensic pass later).
    writeFileSync(join(dir, 'icon.wasm'), FAKE.githubPat, 'utf8');
    const { exit, out } = runScanner(['--dir', dir], process.cwd());
    assert.equal(exit, 0, `expected clean binary skip, got: ${out}`);
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

function testMissingArtifactDirTolerated() {
  const { exit, out } = runScanner(['--dir', '/nonexistent/varve-artifact-dir'], process.cwd());
  assert.equal(exit, 0, `expected missing dir tolerated, got: ${out}`);
}

function testCanaryAbsencePasses() {
  const dir = makeArtifactDir();
  try {
    writeFileSync(join(dir, 'index.html'), '<html>Varve</html>\n', 'utf8');
    const { exit, out } = runScanner(
      ['--dir', dir, '--canary', 'VARVE_PRIVATE_TEST_CANARY_DO_NOT_SHIP'],
      process.cwd(),
    );
    assert.equal(exit, 0, `expected clean canary run, got: ${out}`);
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

function testCanaryLeakFails() {
  const dir = makeArtifactDir();
  try {
    writeFileSync(
      join(dir, 'config.json'),
      '{"x": "VARVE_PRIVATE_TEST_CANARY_DO_NOT_SHIP"}\n',
      'utf8',
    );
    const { exit, out } = runScanner(
      ['--dir', dir, '--canary', 'VARVE_PRIVATE_TEST_CANARY_DO_NOT_SHIP'],
      process.cwd(),
    );
    assert.notEqual(exit, 0, 'expected canary leak to fail the scan');
    assert.ok(out.includes('[canary]'), `expected canary rule in output: ${out}`);
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

function testArtifactScanSkipsNodeModules() {
  const dir = makeArtifactDir();
  try {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules/evil.js'), FAKE.githubPat, 'utf8');
    const { exit, out } = runScanner(['--dir', dir], process.cwd());
    assert.equal(exit, 0, `expected node_modules skip, got: ${out}`);
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

function testCertificateSizePemBlobFails() {
  const dir = makeArtifactDir();
  try {
    // A realistic certificate-sized base64 blob (X.509/PKCS12 material is
    // ~1-4 KB): must still be flagged.
    const certBlob = `MII${'A'.repeat(2000)}==`;
    writeFileSync(join(dir, 'config.json'), `{"cert": "${certBlob}"}\n`, 'utf8');
    assertArtifactFinding(dir, 'pem-base64-blob');
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

function testDataSizedPemBlobIgnored() {
  const dir = makeArtifactDir();
  try {
    // Bundler-inlined binary data (e.g. the wawoff2 WASM decoder ships
    // ~866 KB of base64) must not trigger the cert rule.
    const hugeBlob = `MII${'B'.repeat(400000)}==`;
    writeFileSync(join(dir, 'decoder.js'), `const wasm = "${hugeBlob}";\n`, 'utf8');
    const { exit, out } = runScanner(['--dir', dir], process.cwd());
    assert.equal(exit, 0, `expected data blob ignored, got: ${out}`);
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

testStagedCanaryFails();
testPrivateKeyCanaryFails();
testEnvSecretCanaryFails();
testSecretReferenceDoesNotFail();
testAllowlistedFixturePathPasses();
testStagedOnlyScanIgnoresCommittedCanary();
testArtifactDirCatchesCredentialShapedContent();
testArtifactScanIgnoresBinaries();
testMissingArtifactDirTolerated();
testCanaryAbsencePasses();
testCanaryLeakFails();
testArtifactScanSkipsNodeModules();
testCertificateSizePemBlobFails();
testDataSizedPemBlobIgnored();

console.log('secret-scan tests passed (14 canaries).');
