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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createValidationSnapshot } from './validation-snapshot.mjs';

const repo = mkdtempSync(join(tmpdir(), 'varve-validation-snapshot-'));
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
try {
  git(['init', '-q', '-b', 'master']);
  git(['config', 'user.email', 'varve-tests@example.invalid']);
  git(['config', 'user.name', 'Varve snapshot tests']);
  const shared = join(repo, 'packages', 'shared');
  const utility = join(repo, 'packages', 'utility');
  const client = join(repo, 'apps', 'client');
  mkdirSync(shared, { recursive: true });
  mkdirSync(client, { recursive: true });
  mkdirSync(utility, { recursive: true });
  writeFileSync(join(shared, 'package.json'), '{"name":"@fixture/shared","main":"index.cjs"}');
  writeFileSync(
    join(shared, 'index.cjs'),
    'module.exports = "committed dependency " + require("fixture-utility");\n',
  );
  writeFileSync(join(utility, 'package.json'), '{"name":"fixture-utility","main":"index.cjs"}');
  writeFileSync(join(utility, 'index.cjs'), 'module.exports = "committed utility";\n');
  writeFileSync(join(utility, 'cli.cjs'), 'console.log("committed workspace CLI");\n');
  mkdirSync(join(shared, 'node_modules'));
  symlinkSync(
    utility,
    join(shared, 'node_modules', 'fixture-utility'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  writeFileSync(join(client, 'package.json'), '{"name":"fixture-client"}');
  const installedScope = join(client, 'node_modules', '@fixture');
  mkdirSync(installedScope, { recursive: true });
  symlinkSync(
    shared,
    join(installedScope, 'shared'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  mkdirSync(join(client, 'node_modules', '.bin'));
  symlinkSync(
    join(utility, 'cli.cjs'),
    join(client, 'node_modules', '.bin', 'fixture-cli'),
    process.platform === 'win32' ? 'file' : undefined,
  );
  mkdirSync(join(client, 'node_modules', 'installed-fixture'));
  writeFileSync(
    join(client, 'node_modules', 'installed-fixture', 'index.js'),
    'module.exports = "installed third-party dependency";\n',
  );
  mkdirSync(join(client, 'node_modules', '.vite'));
  writeFileSync(
    join(client, 'node_modules', '.vite', 'caller-config.js'),
    'throw Error("caller configuration");\n',
  );
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
  writeFileSync(join(repo, '.gitignore'), '/target/\n/Cargo.lock\nnode_modules/\n');
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
  git([
    'add',
    '--',
    'tracked.txt',
    '.gitignore',
    'Cargo.toml',
    'src/main.rs',
    'packages/shared',
    'packages/utility',
    'apps/client/package.json',
  ]);
  git(['commit', '-qm', 'snapshot base']);
  const sha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repo, 'tracked.txt'), 'dirty caller state\n');
  writeFileSync(
    join(shared, 'index.cjs'),
    'module.exports = "dirty dependency must not execute";\n',
  );
  writeFileSync(join(utility, 'index.cjs'), 'throw Error("dirty utility must not execute");\n');
  writeFileSync(join(utility, 'cli.cjs'), 'throw Error("dirty workspace CLI must not execute");\n');
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
    const snapshotClient = join(snapshot.path, 'apps', 'client');
    const resolveDependency = createRequire(join(snapshotClient, 'package.json'));
    assert.equal(
      realpathSync(resolveDependency.resolve('@fixture/shared')),
      join(snapshot.path, 'packages', 'shared', 'index.cjs'),
      'workspace imports must resolve inside the exact snapshot, never the dirty checkout',
    );
    assert.equal(
      execFileSync(process.execPath, ['-e', 'console.log(require("@fixture/shared"))'], {
        cwd: snapshotClient,
        encoding: 'utf8',
      }).trim(),
      'committed dependency committed utility',
    );
    assert.equal(
      execFileSync(process.execPath, ['node_modules/.bin/fixture-cli'], {
        cwd: snapshotClient,
        encoding: 'utf8',
      }).trim(),
      'committed workspace CLI',
    );
    assert.equal(
      execFileSync(process.execPath, ['-e', 'console.log(require("installed-fixture"))'], {
        cwd: snapshotClient,
        encoding: 'utf8',
      }).trim(),
      'installed third-party dependency',
    );
    assert.equal(
      existsSync(join(snapshotClient, 'node_modules', '.vite', 'caller-config.js')),
      false,
    );
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
