import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRepoSlug, releaseDownloadBaseUrl, repoHttpsUrl, repoSlug } from './product.mjs';

const originalGithub = process.env.GITHUB_REPOSITORY;
const originalOverride = process.env.VARVE_GITHUB_REPOSITORY;

function restore() {
  if (originalGithub === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = originalGithub;
  if (originalOverride === undefined) delete process.env.VARVE_GITHUB_REPOSITORY;
  else process.env.VARVE_GITHUB_REPOSITORY = originalOverride;
}

function withTempGit(remote, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'varve-repo-slug-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    if (remote) {
      execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir, stdio: 'ignore' });
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  process.env.GITHUB_REPOSITORY = 'varvedesign/varve';
  delete process.env.VARVE_GITHUB_REPOSITORY;
  assert.equal(repoSlug(), 'varvedesign/varve');
  assert.equal(repoHttpsUrl(), 'https://github.com/varvedesign/varve');
  assert.equal(
    releaseDownloadBaseUrl('0.5.1'),
    'https://github.com/varvedesign/varve/releases/download/v0.5.1',
  );
  assert.equal(
    releaseDownloadBaseUrl('v0.5.1'),
    'https://github.com/varvedesign/varve/releases/download/v0.5.1',
  );

  process.env.GITHUB_REPOSITORY = 'K-Arthur/varve';
  assert.equal(
    releaseDownloadBaseUrl('v0.2.0'),
    'https://github.com/K-Arthur/varve/releases/download/v0.2.0',
  );

  assert.equal(
    repoSlug({
      env: {
        VARVE_GITHUB_REPOSITORY: 'varvedesign/varve',
        GITHUB_REPOSITORY: 'other/fork',
      },
    }),
    'varvedesign/varve',
  );

  assert.equal(assertRepoSlug('acme/varve'), 'acme/varve');
  assert.throws(() => assertRepoSlug('not-a-slug'), /Invalid GitHub repository slug/);
  assert.throws(() => assertRepoSlug('../evil'), /Invalid GitHub repository slug/);
  assert.throws(() => assertRepoSlug('owner/..'), /Invalid GitHub repository slug/);
  assert.throws(
    () => repoSlug({ env: { GITHUB_REPOSITORY: 'not-a-slug' } }),
    /Invalid GitHub repository slug/,
  );
  assert.throws(
    () =>
      repoSlug({
        env: { VARVE_GITHUB_REPOSITORY: 'bad', GITHUB_REPOSITORY: 'acme/varve' },
      }),
    /Invalid GitHub repository slug/,
  );

  withTempGit(null, (dir) => {
    assert.throws(
      () => repoSlug({ env: {}, gitCwd: dir }),
      /no VARVE_GITHUB_REPOSITORY, no GITHUB_REPOSITORY, and no git remote "origin"/,
    );
  });

  withTempGit('https://github.com/acme/varve.git', (dir) => {
    assert.equal(repoSlug({ env: {}, gitCwd: dir }), 'acme/varve');
  });

  withTempGit('git@github.com:acme/varve.git', (dir) => {
    assert.equal(repoSlug({ env: {}, gitCwd: dir }), 'acme/varve');
  });
} finally {
  restore();
}

console.log('product.test.mjs — all tests passed');
