#!/usr/bin/env node

/**
 * Regression checks for dependency-level supply-chain remediations.
 *
 * The package manager's generic audit output does not understand local patch
 * files, so these assertions keep the effective lockfile policy and the
 * patched extractor behavior from drifting silently.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workspace = readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
const lockfile = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
const flatpakSources = readFileSync(
  path.join(repoRoot, 'packaging', 'flatpak', 'pnpm-sources.json'),
  'utf8',
);
const extractPatch = readFileSync(
  path.join(repoRoot, 'patches', 'extract-zip@2.0.1.patch'),
  'utf8',
);

assert.match(workspace, /"adm-zip": 0\.6\.1/);
assert.match(workspace, /"brace-expansion@5": 5\.0\.12/);
assert.match(workspace, /"fast-uri": 3\.1\.8/);
assert.match(workspace, /"js-yaml@4": 4\.3\.2/);
assert.match(workspace, /"sharp": 0\.35\.5/);
assert.match(workspace, /"svgo@4": 4\.1\.0/);
assert.match(workspace, /"deepmerge-ts": 8\.0\.0/);
assert.match(workspace, /extract-zip@2\.0\.1: patches\/extract-zip@2\.0\.1\.patch/);

assert.match(lockfile, /adm-zip: 0\.6\.1/);
assert.match(lockfile, /brace-expansion@5: 5\.0\.12/);
assert.match(lockfile, /deepmerge-ts@8\.0\.0/);
assert.doesNotMatch(lockfile, /deepmerge-ts@7\.1\.5/);
assert.match(lockfile, /onnxruntime-node@[\s\S]*?adm-zip: 0\.6\.1/);
assert.match(lockfile, /extract-zip: 2\.0\.1\(patch_hash=[0-9a-f]{64}\)/);

assert.match(flatpakSources, /deepmerge-ts-8\.0\.0\.tgz/);
assert.match(
  flatpakSources,
  /20236368fd0c2fe792744a496100b8e978809ff52301dc1b125d1d13ca7ce594de3438a737829de3ef634b839202e1fbb2de9e0bbad086ca93179cc80da526da/,
);
assert.doesNotMatch(flatpakSources, /deepmerge-ts-7\.1\.5\.tgz/);

assert.match(extractPatch, /path\.isAbsolute\(link\)/);
assert.match(extractPatch, /relativeLink\.startsWith\(`\.\.\$\{path\.sep\}`\)/);
assert.match(extractPatch, /Out of bound symlink target/);
// The upstream fix for GHSA-7pqw-9j4j-h8q3 additionally refuses to write a
// regular entry through a symlink leaf. Runtime proof lives in
// scripts/security/extract-zip-containment.test.mjs.
assert.match(extractPatch, /lstat\(dest\)/);
assert.match(extractPatch, /existing\.isSymbolicLink\(\)/);
assert.match(extractPatch, /Out of bound path/);

// Behavioural proof: extract real malicious archives against the patched
// module the lockfile resolves and confirm the outside canary is untouched.
// Run as a child with the test runner so a broken patch cannot pass this file
// by matching its own patch text.
const containment = spawnSync(
  process.execPath,
  ['--test', path.join('scripts', 'security', 'extract-zip-containment.test.mjs')],
  { cwd: repoRoot, stdio: 'inherit' },
);
assert.equal(containment.status, 0, 'extract-zip containment regression must pass');

console.log('dependency hardening checks passed');
