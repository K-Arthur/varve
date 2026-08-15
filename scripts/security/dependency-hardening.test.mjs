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
const extractPatch = readFileSync('patches/extract-zip@2.0.1.patch', 'utf8');

assert.match(workspace, /"adm-zip": 0\.6\.0/);
assert.match(workspace, /"brace-expansion@5": 5\.0\.9/);
assert.match(workspace, /extract-zip@2\.0\.1: patches\/extract-zip@2\.0\.1\.patch/);

assert.match(lockfile, /adm-zip: 0\.6\.0/);
assert.match(lockfile, /brace-expansion@5: 5\.0\.9/);
assert.match(lockfile, /onnxruntime-node@[\s\S]*?adm-zip: 0\.6\.0/);
assert.match(lockfile, /extract-zip: 2\.0\.1\(patch_hash=[0-9a-f]{64}\)/);

assert.match(extractPatch, /path\.isAbsolute\(link\)/);
assert.match(extractPatch, /relativeLink\.startsWith\(`\.\.\$\{path\.sep\}`\)/);
assert.match(extractPatch, /Out of bound symlink target/);

console.log('dependency hardening checks passed');
