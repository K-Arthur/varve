#!/usr/bin/env node
/**
 * Regression: resolve_github_repo must prefer VARVE_GITHUB_REPOSITORY, then
 * GITHUB_REPOSITORY, then git origin, and reject malformed slugs.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const script = readFileSync(join(root, 'update-packaging.sh'), 'utf8');

const slugFn = script.match(/^assert_github_repo_slug\(\) \{[\s\S]*?^}/m);
const resolveFn = script.match(/^resolve_github_repo\(\) \{[\s\S]*?^}/m);
assert.ok(slugFn, 'update-packaging.sh must define assert_github_repo_slug()');
assert.ok(resolveFn, 'update-packaging.sh must define resolve_github_repo()');
assert.match(
  resolveFn[0],
  /VARVE_GITHUB_REPOSITORY[\s\S]*elif[\s\S]*GITHUB_REPOSITORY/,
  'VARVE_GITHUB_REPOSITORY must take precedence over GITHUB_REPOSITORY',
);
assert.match(
  slugFn[0],
  /GITHUB_REPO_SLUG_RE/,
  'assert_github_repo_slug must use GITHUB_REPO_SLUG_RE',
);

function withTempGit(remote, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'varve-packaging-repo-'));
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

function runResolve({ env = {}, gitCwd }) {
  const bash = `
set -euo pipefail
REPO_ROOT=${JSON.stringify(gitCwd)}
GITHUB_REPO_SLUG_RE='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
${slugFn[0]}
${resolveFn[0]}
resolve_github_repo "$REPO_ROOT"
`;
  return spawnSync('bash', ['-c', bash], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      VARVE_GITHUB_REPOSITORY: env.VARVE_GITHUB_REPOSITORY ?? '',
      GITHUB_REPOSITORY: env.GITHUB_REPOSITORY ?? '',
    },
  });
}

{
  const result = withTempGit(null, (dir) =>
    runResolve({
      env: { VARVE_GITHUB_REPOSITORY: 'varvedesign/varve', GITHUB_REPOSITORY: 'other/fork' },
      gitCwd: dir,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'varvedesign/varve');
}

{
  const result = withTempGit(null, (dir) =>
    runResolve({
      env: { GITHUB_REPOSITORY: 'K-Arthur/varve' },
      gitCwd: dir,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'K-Arthur/varve');
}

{
  const result = withTempGit('https://github.com/acme/varve.git', (dir) =>
    runResolve({ env: {}, gitCwd: dir }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'acme/varve');
}

{
  const result = withTempGit(null, (dir) => runResolve({ env: {}, gitCwd: dir }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot determine GitHub repository/);
}

{
  const result = withTempGit(null, (dir) =>
    runResolve({ env: { GITHUB_REPOSITORY: 'not-a-slug' }, gitCwd: dir }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid GitHub repository slug/);
}

{
  const repoRoot = join(root, '..', '..');
  const pkgbuild = readFileSync(join(repoRoot, 'packaging/aur/varve-desktop-bin/PKGBUILD'), 'utf8');
  const srcinfo = readFileSync(join(repoRoot, 'packaging/aur/varve-desktop-bin/.SRCINFO'), 'utf8');
  const pkgver = pkgbuild.match(/^pkgver=(.+)$/m)[1];
  const url = pkgbuild.match(/^url="([^"]+)"/m)[1];
  const releaseHost = pkgbuild.match(/^_gh_release="([^"]+)"/m)[1];
  assert.equal(releaseHost, 'https://github.com/K-Arthur/varve');
  assert.match(srcinfo, new RegExp(`^\\tpkgver = ${pkgver}$`, 'm'));
  assert.ok(srcinfo.includes(`\turl = ${url}`));
  assert.ok(
    srcinfo.includes(
      `source_x86_64 = Varve-${pkgver}-linux-x86_64.AppImage::${releaseHost}/releases/download/v${pkgver}/`,
    ),
  );
  assert.ok(
    srcinfo.includes(
      `source_aarch64 = Varve-${pkgver}-linux-aarch64.AppImage::${releaseHost}/releases/download/v${pkgver}/`,
    ),
  );
  assert.doesNotMatch(srcinfo, /varvedesign\/varve\/releases\/download/);
}

console.log('update-packaging-repo tests passed');
