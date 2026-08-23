#!/usr/bin/env node

/**
 * Regression checks for dependency-level supply-chain remediations.
 *
 * The package manager's generic audit output does not understand local patch
 * files, so these assertions keep the effective lockfile policy and the
 * patched extractor behavior from drifting silently.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');
const flatpakSources = readFileSync('packaging/flatpak/pnpm-sources.json', 'utf8');
const extractPatch = readFileSync('patches/extract-zip@2.0.1.patch', 'utf8');

assert.match(workspace, /"adm-zip": 0\.6\.0/);
assert.match(workspace, /"brace-expansion@5": 5\.0\.9/);
assert.match(workspace, /"deepmerge-ts": 8\.0\.0/);
assert.match(workspace, /extract-zip@2\.0\.1: patches\/extract-zip@2\.0\.1\.patch/);

assert.match(lockfile, /adm-zip: 0\.6\.0/);
assert.match(lockfile, /brace-expansion@5: 5\.0\.9/);
assert.match(lockfile, /deepmerge-ts@8\.0\.0/);
assert.doesNotMatch(lockfile, /deepmerge-ts@7\.1\.5/);
assert.match(lockfile, /onnxruntime-node@[\s\S]*?adm-zip: 0\.6\.0/);
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

console.log('dependency hardening checks passed');
