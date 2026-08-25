#!/usr/bin/env node

/**
 * Regression tests for the git-hook installer.
 *
 * The bug these guard against: `git lfs install` set `core.hooksPath` to
 * `.githooks`, which makes Git ignore `.git/hooks` completely. The old
 * installer copied the hooks into `.git/hooks` anyway, so the pre-commit
 * format/lint gate and the pre-push validation gate were silently inert and
 * unformatted code reached master and broke CI on every platform.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOOKS_DIR, installHooks } from './install-git-hooks.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
  }
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

/** A throwaway repo with the tracked hooks directory present. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'varve-hooks-'));
  git(dir, 'init', '-q', '.');
  mkdirSync(join(dir, HOOKS_DIR), { recursive: true });
  writeFileSync(
    join(dir, HOOKS_DIR, 'pre-commit'),
    '#!/bin/sh\n# Varve pre-commit hook.\nexit 0\n',
  );
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

const quiet = { log: () => {} };

console.log('install-git-hooks regression tests\n');

test('sets core.hooksPath to the tracked hooks directory', () => {
  const dir = makeRepo();
  installHooks(dir, quiet);
  assert.equal(git(dir, 'config', '--local', '--get', 'core.hooksPath'), HOOKS_DIR);
});

test('repoints a core.hooksPath left behind by another tool', () => {
  const dir = makeRepo();
  git(dir, 'config', '--local', 'core.hooksPath', '.some-other-hooks');
  installHooks(dir, quiet);
  assert.equal(git(dir, 'config', '--local', '--get', 'core.hooksPath'), HOOKS_DIR);
});

test('is idempotent — a second run reports no change', () => {
  const dir = makeRepo();
  installHooks(dir, quiet);
  assert.equal(installHooks(dir, quiet).changed, false);
});

test('removes stale Varve copies stranded in .git/hooks', () => {
  const dir = makeRepo();
  const stale = join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(stale, '#!/bin/sh\n# Varve pre-commit hook.\nexit 0\n');
  installHooks(dir, quiet);
  assert.equal(existsSync(stale), false, '.git/hooks copy should be removed');
});

test("never deletes a contributor's own hook", () => {
  const dir = makeRepo();
  const mine = join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(mine, '#!/bin/sh\n# my own hook\nexit 0\n');
  installHooks(dir, quiet);
  assert.equal(existsSync(mine), true, 'unowned hook must be left alone');
});

test('the repository itself is configured to use the tracked hooks', () => {
  assert.equal(
    git(REPO_ROOT, 'config', '--local', '--get', 'core.hooksPath'),
    HOOKS_DIR,
    'run `node scripts/install-git-hooks.mjs` to repair',
  );
});

test('the gating hooks are tracked and executable', () => {
  const tracked = git(REPO_ROOT, 'ls-files', '-s', HOOKS_DIR);
  for (const hook of ['pre-commit', 'pre-push', 'commit-msg']) {
    const line = tracked.split('\n').find((l) => l.endsWith(`${HOOKS_DIR}/${hook}`));
    assert.ok(line, `${HOOKS_DIR}/${hook} must be tracked`);
    assert.ok(line.startsWith('100755'), `${HOOKS_DIR}/${hook} must be mode 100755, got: ${line}`);
  }
});

test('no vestigial git-lfs hooks remain (LFS is no longer used)', () => {
  // The working tree is what Git actually executes, so check that, not HEAD.
  for (const path of git(REPO_ROOT, 'ls-files', HOOKS_DIR).split('\n')) {
    if (!path) continue;
    const body = readFileSync(join(REPO_ROOT, path), 'utf-8');
    assert.ok(
      !body.includes('git lfs'),
      `${path} still delegates to git-lfs; it exits 2 when git-lfs is absent`,
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
