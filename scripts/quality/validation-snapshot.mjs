#!/usr/bin/env node

/**
 * Disposable exact-tree worktrees for local validation.
 *
 * Git's pre-push hook runs before the transport updates the remote, and the
 * caller may have unrelated staged/unstaged files or may be pushing another
 * local ref. A validation receipt is only meaningful when commands execute
 * against the target commit's tree. Dependencies are linked read-only from
 * the caller's installed workspace; source files always come from the clean
 * detached worktree.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createGitAdapter } from './history-policy.mjs';

const SHA = /^[0-9a-f]{40}$/;

function runGit(args, cwd) {
  return createGitAdapter(cwd).run(args);
}

function dependencyPaths(root) {
  const paths = ['node_modules'];
  for (const parent of ['apps', 'packages']) {
    const dir = join(root, parent);
    if (!existsSync(dir)) continue;
    for (const entry of requireDirectoryNames(dir)) paths.push(`${parent}/${entry}/node_modules`);
  }
  return paths;
}

function requireDirectoryNames(path) {
  // Keep this helper dependency-free and tolerant of a package being removed
  // while a worktree is being created.
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function linkDependencies(sourceRoot, snapshotRoot) {
  for (const relativePath of dependencyPaths(sourceRoot)) {
    const source = join(sourceRoot, relativePath);
    const target = join(snapshotRoot, relativePath);
    if (!existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

export function createValidationSnapshot({ sha, root = process.cwd() } = {}) {
  if (!SHA.test(String(sha ?? ''))) throw new Error(`invalid validation target SHA '${sha}'`);
  const parent = mkdtempSync(join(tmpdir(), 'varve-validation-tree-'));
  const path = join(parent, 'tree');
  const add = runGit(['worktree', 'add', '--detach', '--no-checkout', '--quiet', path, sha], root);
  if (add.status !== 0) {
    rmSync(parent, { recursive: true, force: true });
    throw new Error(add.stderr.trim() || `could not create validation worktree for ${sha}`);
  }
  const reset = runGit(['reset', '--hard', '--quiet', sha], path);
  if (reset.status !== 0) {
    runGit(['worktree', 'remove', '--force', path], root);
    rmSync(parent, { recursive: true, force: true });
    throw new Error(reset.stderr.trim() || `could not materialize validation tree for ${sha}`);
  }
  try {
    linkDependencies(root, path);
  } catch (error) {
    runGit(['worktree', 'remove', '--force', path], root);
    rmSync(parent, { recursive: true, force: true });
    throw new Error(`could not link validation dependencies: ${error.message}`);
  }
  let cleaned = false;
  return {
    path,
    sha,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      runGit(['worktree', 'remove', '--force', path], root);
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

export function createValidationSnapshots(shas, options = {}) {
  const snapshots = [];
  try {
    for (const sha of [...new Set(shas)].filter(Boolean)) {
      snapshots.push(createValidationSnapshot({ ...options, sha }));
    }
    return snapshots;
  } catch (error) {
    for (const snapshot of snapshots) snapshot.cleanup();
    throw error;
  }
}
