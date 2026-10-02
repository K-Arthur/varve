#!/usr/bin/env node

/**
 * Disposable exact-tree worktrees for local validation.
 *
 * Git's pre-push hook runs before the transport updates the remote, and the
 * caller may have unrelated staged/unstaged files or may be pushing another
 * local ref. A validation receipt is only meaningful when commands execute
 * against the target commit's tree. Third-party dependencies are shared from
 * the caller's installed workspace; source files always come from the clean
 * detached worktree. Workspace dependency links resolve inside that snapshot;
 * only installed third-party dependencies are shared with the caller.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createGitAdapter } from './history-policy.mjs';
import { commonGitDirectory } from './validation-receipts.mjs';

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

function workspacePackages(root) {
  const packages = new Map();
  for (const parent of ['apps', 'packages']) {
    for (const name of requireDirectoryNames(join(root, parent))) {
      const path = join(root, parent, name);
      const manifest = join(path, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (typeof pkg.name === 'string') packages.set(pkg.name, path);
      }
    }
  }
  return packages;
}

function rebaseWorkspaceDependency(installed, workspace, callerWorkspace) {
  const resolved = realpathSync(installed);
  for (const [name, path] of callerWorkspace) {
    if (resolved !== path && !resolved.startsWith(`${path}${sep}`)) continue;
    // A third-party installation can live under a workspace's node_modules;
    // that location is installed dependency storage rather than product source.
    if (relative(path, resolved).split(sep).includes('node_modules')) return installed;
    const snapshotPackage = workspace.get(name);
    if (!snapshotPackage) return null;
    const rebased = join(snapshotPackage, relative(path, resolved));
    return existsSync(rebased) ? rebased : null;
  }
  return installed;
}

function linkDependencyEntries(source, target, workspace, callerWorkspace, scope = '') {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const installed = join(source, entry.name);
    const destination = join(target, entry.name);
    if (existsSync(destination)) continue;
    if (!scope && (entry.name.startsWith('@') || entry.name === '.bin') && entry.isDirectory()) {
      linkDependencyEntries(installed, destination, workspace, callerWorkspace, entry.name);
      continue;
    }
    // Vite and tool caches contain per-checkout configuration, so keep them
    // local to the snapshot rather than sharing generated source with callers.
    if (entry.name.startsWith('.vite') || entry.name === '.cache') continue;
    const name = scope.startsWith('@') ? `${scope}/${entry.name}` : entry.name;
    if (callerWorkspace.has(name) && !workspace.has(name)) continue;
    const sourcePath =
      workspace.get(name) ?? rebaseWorkspaceDependency(installed, workspace, callerWorkspace);
    if (!sourcePath) continue;
    symlinkSync(
      sourcePath,
      destination,
      process.platform === 'win32'
        ? statSync(sourcePath).isDirectory()
          ? 'junction'
          : 'file'
        : undefined,
    );
  }
}

function linkDependencies(sourceRoot, snapshotRoot) {
  const workspace = workspacePackages(snapshotRoot);
  const callerWorkspace = workspacePackages(sourceRoot);
  for (const relativePath of dependencyPaths(snapshotRoot)) {
    const source = join(sourceRoot, relativePath);
    const target = join(snapshotRoot, relativePath);
    if (!existsSync(source) || existsSync(target)) continue;
    linkDependencyEntries(source, target, workspace, callerWorkspace);
  }
}

function linkCargoCache(sourceRoot, snapshotRoot) {
  const target = join(snapshotRoot, 'target');
  // Never replace anything supplied by the committed tree. Cargo's own
  // fingerprints and artifact locks govern reuse; this is a build cache,
  // not a passing validation receipt or a source overlay.
  if (!existsSync(join(snapshotRoot, 'Cargo.toml')) || existsSync(target)) return null;
  const cache = join(
    commonGitDirectory({ git: createGitAdapter(sourceRoot), cwd: sourceRoot }),
    'varve-validation',
    'cargo-target',
  );
  mkdirSync(cache, { recursive: true });
  symlinkSync(cache, target, process.platform === 'win32' ? 'junction' : 'dir');
  return cache;
}

export function createValidationSnapshot({ sha, root = process.cwd() } = {}) {
  if (!SHA.test(String(sha ?? ''))) throw new Error(`invalid validation target SHA '${sha}'`);
  // Node resolves installed links physically. Use that same caller root for
  // workspace rebasing, Git operations, and Cargo cache ownership; /var on
  // macOS and a symlinked TMPDIR must not turn workspace CLIs into dirty links.
  const sourceRoot = realpathSync(root);
  const parent = mkdtempSync(join(tmpdir(), 'varve-validation-tree-'));
  const path = join(parent, 'tree');
  const add = runGit(
    ['worktree', 'add', '--detach', '--no-checkout', '--quiet', path, sha],
    sourceRoot,
  );
  if (add.status !== 0) {
    rmSync(parent, { recursive: true, force: true });
    throw new Error(add.stderr.trim() || `could not create validation worktree for ${sha}`);
  }
  const reset = runGit(['reset', '--hard', '--quiet', sha], path);
  if (reset.status !== 0) {
    runGit(['worktree', 'remove', '--force', path], sourceRoot);
    rmSync(parent, { recursive: true, force: true });
    throw new Error(reset.stderr.trim() || `could not materialize validation tree for ${sha}`);
  }
  let cargoCache;
  try {
    linkDependencies(sourceRoot, path);
    cargoCache = linkCargoCache(sourceRoot, path);
  } catch (error) {
    runGit(['worktree', 'remove', '--force', path], sourceRoot);
    rmSync(parent, { recursive: true, force: true });
    throw new Error(`could not link validation build inputs: ${error.message}`);
  }
  let cleaned = false;
  return {
    path,
    sha,
    cargoCache,
    // Canonicalize the output path as well as preserving its directory.
    // Different temporary symlink spellings must not invalidate Cargo's
    // build-script environment and dependency fingerprints on every retry.
    env: cargoCache ? { CARGO_TARGET_DIR: cargoCache } : {},
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      const remove = runGit(['worktree', 'remove', '--force', path], sourceRoot);
      if (remove.status !== 0) {
        cleaned = false;
        throw new Error(remove.stderr.trim() || `could not clean validation worktree for ${sha}`);
      }
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
