#!/usr/bin/env node

/** Exact-tree fixture: dirty caller state never changes the validation tree. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createValidationSnapshot } from './validation-snapshot.mjs';

const repo = mkdtempSync(join(tmpdir(), 'varve-validation-snapshot-'));
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
try {
  git(['init', '-q', '-b', 'master']);
  git(['config', 'user.email', 'varve-tests@example.invalid']);
  git(['config', 'user.name', 'Varve snapshot tests']);
  writeFileSync(join(repo, 'tracked.txt'), 'committed tree\n');
  git(['add', '--', 'tracked.txt']);
  git(['commit', '-qm', 'snapshot base']);
  const sha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repo, 'tracked.txt'), 'dirty caller state\n');
  writeFileSync(join(repo, 'untracked.txt'), 'not in target\n');
  const snapshot = createValidationSnapshot({ sha, root: repo });
  try {
    assert.equal(readFileSync(join(snapshot.path, 'tracked.txt'), 'utf8'), 'committed tree\n');
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'dirty caller state\n');
  } finally {
    snapshot.cleanup();
  }
  assert.equal(git(['worktree', 'list', '--porcelain']).split('\n').length > 0, true);
  console.log('validation snapshot tests passed');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
