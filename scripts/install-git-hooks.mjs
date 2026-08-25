#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Point Git at the repository's tracked hooks in `.githooks`.
 *
 * Runs automatically during pnpm install via the `prepare` script.
 * Skips installation in CI environments.
 *
 * History: the hooks used to be copied from `.github/hooks` into `.git/hooks`.
 * That silently stopped working once `git lfs install` set `core.hooksPath` to
 * `.githooks`, because Git ignores `.git/hooks` entirely whenever
 * `core.hooksPath` is set. The pre-commit format/lint gate and the pre-push
 * validation gate were both dead for as long as that config was in place, and
 * unformatted code reached master as a result. The hooks are now tracked in
 * `.githooks` and this script only has to make the config agree.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOKS_DIR = '.githooks';

/** Hooks this repository owns, and the marker proving a file is our copy. */
const OWNED_HOOKS = ['pre-commit', 'pre-push', 'commit-msg'];
const OWNED_MARKER =
  /^# Varve (pre-commit|pre-push|commit-msg) hook\.|commit-msg hook: reject AI tool attribution/m;

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf-8' });
  return { status: result.status, stdout: (result.stdout ?? '').trim() };
}

/**
 * Remove hook copies left in `.git/hooks` by the old copy-based installer.
 * Only files carrying our own header are removed — a contributor's unrelated
 * hook is never touched.
 */
export function removeStaleCopies(root, gitDir) {
  const removed = [];
  for (const hook of OWNED_HOOKS) {
    const stale = join(gitDir, 'hooks', hook);
    if (!existsSync(stale)) continue;
    let contents = '';
    try {
      contents = readFileSync(stale, 'utf-8');
    } catch {
      continue;
    }
    if (!OWNED_MARKER.test(contents)) continue;
    rmSync(stale, { force: true });
    removed.push(stale);
  }
  return removed;
}

export function installHooks(root, { log = console.log } = {}) {
  if (!existsSync(join(root, HOOKS_DIR))) {
    log(`install-git-hooks: skipping (${HOOKS_DIR} not found)`);
    return { changed: false, skipped: true };
  }

  const current = git(root, ['config', '--local', '--get', 'core.hooksPath']).stdout;
  let changed = false;

  if (current !== HOOKS_DIR) {
    const set = git(root, ['config', '--local', 'core.hooksPath', HOOKS_DIR]);
    if (set.status !== 0) {
      log('install-git-hooks: could not set core.hooksPath; hooks are NOT active');
      return { changed: false, failed: true };
    }
    log(
      current
        ? `install-git-hooks: core.hooksPath ${current} -> ${HOOKS_DIR}`
        : `install-git-hooks: core.hooksPath set to ${HOOKS_DIR}`,
    );
    changed = true;
  }

  // `git rev-parse --git-dir` resolves linked worktrees to their real gitdir,
  // so stale copies are cleaned up from wherever they actually live.
  const gitDirOut = git(root, ['rev-parse', '--absolute-git-dir']);
  if (gitDirOut.status === 0 && gitDirOut.stdout) {
    for (const stale of removeStaleCopies(root, gitDirOut.stdout)) {
      log(`install-git-hooks: removed stale copy ${stale}`);
      changed = true;
    }
  }

  return { changed, hooksPath: HOOKS_DIR };
}

function main() {
  if (process.env.CI || process.env.NODE_ENV === 'ci') {
    console.log('install-git-hooks: skipping in CI');
    return;
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  // Not a git checkout (tarball install, vendored copy): nothing to configure.
  if (git(root, ['rev-parse', '--git-dir']).status !== 0) {
    console.log('install-git-hooks: skipping (not a git repository)');
    return;
  }

  const result = installHooks(root);
  if (!result.changed && !result.skipped && !result.failed) {
    console.log(`install-git-hooks: hooks already active (core.hooksPath=${HOOKS_DIR})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
