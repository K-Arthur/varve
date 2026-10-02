#!/usr/bin/env node

/** Exact-tree fixture: dirty caller state never changes the validation tree. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  writeFileSync(join(repo, '.gitignore'), '/target/\n/Cargo.lock\n');
  writeFileSync(
    join(repo, 'Cargo.toml'),
    '[package]\nname = "snapshot-cache-probe"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/main.rs'), 'fn main() { println!("first committed source"); }\n');
  git(['add', '--', 'tracked.txt', '.gitignore', 'Cargo.toml', 'src/main.rs']);
  git(['commit', '-qm', 'snapshot base']);
  const sha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repo, 'tracked.txt'), 'dirty caller state\n');
  writeFileSync(join(repo, 'untracked.txt'), 'not in target\n');
  const snapshot = createValidationSnapshot({ sha, root: repo });
  const cache = snapshot.cargoCache;
  const binaryName =
    process.platform === 'win32' ? 'snapshot-cache-probe.exe' : 'snapshot-cache-probe';
  const buildAndRead = (tree) => {
    execFileSync('cargo', ['build', '--offline', '--quiet'], {
      cwd: tree,
      env: { ...process.env, CARGO_TARGET_DIR: join(tree, 'target') },
      timeout: 60_000,
      stdio: 'pipe',
    });
    return execFileSync(join(cache, 'debug', binaryName), { encoding: 'utf8' }).trim();
  };
  try {
    assert.equal(readFileSync(join(snapshot.path, 'tracked.txt'), 'utf8'), 'committed tree\n');
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'dirty caller state\n');
    assert.equal(existsSync(join(snapshot.path, 'untracked.txt')), false);
    assert.equal(realpathSync(join(snapshot.path, 'target')), realpathSync(cache));
    writeFileSync(join(cache, 'retained-build-marker'), 'cache survives snapshot cleanup\n');
    if (process.argv.includes('--cargo')) {
      assert.equal(buildAndRead(snapshot.path), 'first committed source');
    }
  } finally {
    snapshot.cleanup();
  }
  assert.equal(
    readFileSync(join(cache, 'retained-build-marker'), 'utf8'),
    'cache survives snapshot cleanup\n',
  );
  writeFileSync(join(repo, 'src/main.rs'), 'fn main() { println!("second committed source"); }\n');
  git(['add', '--', 'src/main.rs']);
  git(['commit', '-qm', 'changed compiler input']);
  const secondSha = git(['rev-parse', 'HEAD']);
  writeFileSync(
    join(repo, 'src/main.rs'),
    'fn main() { panic!("dirty source must not execute"); }\n',
  );
  const second = createValidationSnapshot({ sha: secondSha, root: repo });
  try {
    assert.equal(second.cargoCache, cache);
    assert.match(readFileSync(join(second.path, 'src/main.rs'), 'utf8'), /second committed source/);
    if (process.argv.includes('--cargo')) {
      assert.equal(buildAndRead(second.path), 'second committed source');
    }
  } finally {
    second.cleanup();
  }
  assert.equal(existsSync(cache), true);
  assert.equal(git(['worktree', 'list', '--porcelain']).split('\n').length > 0, true);
  console.log('validation snapshot tests passed');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
