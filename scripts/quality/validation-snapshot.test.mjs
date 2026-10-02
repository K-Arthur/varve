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
  const dependency = join(repo, '.git', 'cache-probe-dependency');
  const dependencyBuilds = join(repo, '.git', 'dependency-builds');
  mkdirSync(join(dependency, 'src'), { recursive: true });
  writeFileSync(
    join(dependency, 'Cargo.toml'),
    '[package]\nname = "cache-probe-dependency"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  writeFileSync(join(dependency, 'src/lib.rs'), 'pub fn value() -> u8 { 1 }\n');
  writeFileSync(
    join(dependency, 'build.rs'),
    'use std::io::Write;\nfn main() {\nprintln!("cargo:rerun-if-changed=src/lib.rs");\nlet path = std::env::var("VARVE_CACHE_PROBE").unwrap();\nlet mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();\nwriteln!(file, "dependency compiled").unwrap();\n}\n',
  );
  writeFileSync(join(repo, 'tracked.txt'), 'committed tree\n');
  writeFileSync(join(repo, '.gitignore'), '/target/\n/Cargo.lock\n');
  writeFileSync(
    join(repo, 'Cargo.toml'),
    '[package]\nname = "snapshot-cache-probe"\nversion = "0.1.0"\nedition = "2021"\n' +
      `[dependencies]\ncache-probe-dependency = { path = ${JSON.stringify(dependency)} }\n`,
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(
    join(repo, 'src/main.rs'),
    'fn main() { println!("first committed source {}", cache_probe_dependency::value()); }\n',
  );
  git(['add', '--', 'tracked.txt', '.gitignore', 'Cargo.toml', 'src/main.rs']);
  git(['commit', '-qm', 'snapshot base']);
  const sha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repo, 'tracked.txt'), 'dirty caller state\n');
  writeFileSync(join(repo, 'untracked.txt'), 'not in target\n');
  const snapshot = createValidationSnapshot({ sha, root: repo });
  const cache = snapshot.cargoCache;
  const binaryName =
    process.platform === 'win32' ? 'snapshot-cache-probe.exe' : 'snapshot-cache-probe';
  const buildAndRead = (target) => {
    execFileSync('cargo', ['build', '--offline', '--quiet'], {
      cwd: target.path,
      env: { ...process.env, ...target.env, VARVE_CACHE_PROBE: dependencyBuilds },
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
    assert.deepEqual(snapshot.env, { CARGO_TARGET_DIR: cache });
    writeFileSync(join(cache, 'retained-build-marker'), 'cache survives snapshot cleanup\n');
    if (process.argv.includes('--cargo')) {
      assert.equal(buildAndRead(snapshot), 'first committed source 1');
      assert.equal(readFileSync(dependencyBuilds, 'utf8').trim().split('\n').length, 1);
    }
  } finally {
    snapshot.cleanup();
  }
  assert.equal(
    readFileSync(join(cache, 'retained-build-marker'), 'utf8'),
    'cache survives snapshot cleanup\n',
  );
  writeFileSync(
    join(repo, 'src/main.rs'),
    'fn main() { println!("second committed source {}", cache_probe_dependency::value()); }\n',
  );
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
    assert.deepEqual(second.env, snapshot.env);
    assert.match(readFileSync(join(second.path, 'src/main.rs'), 'utf8'), /second committed source/);
    if (process.argv.includes('--cargo')) {
      assert.equal(buildAndRead(second), 'second committed source 1');
      assert.equal(
        readFileSync(dependencyBuilds, 'utf8').trim().split('\n').length,
        1,
        'unchanged dependency must survive a different snapshot root',
      );
      writeFileSync(join(dependency, 'src/lib.rs'), 'pub fn value() -> u8 { 2 }\n');
      assert.equal(buildAndRead(second), 'second committed source 2');
      assert.equal(
        readFileSync(dependencyBuilds, 'utf8').trim().split('\n').length,
        2,
        'changed dependency must rebuild',
      );
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
