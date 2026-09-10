/**
 * Single source for the product name and repository slug used by release tooling.
 *
 * Both were hardcoded as "Strata" and "K-Arthur/Strata" across the release
 * scripts. With a product rename in progress (Strata -> Varve), that is a
 * silent-failure waiting to happen: artifacts would keep being named
 * `Strata-0.1.0-…` after the rename, and the download page would keep pointing
 * at URLs built from the old slug. Nothing would error — the release would just
 * be wrong.
 *
 * Deriving both from configuration that the rename has to touch anyway means
 * the release pipeline follows the rename instead of needing to be remembered.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Product name used to build artifact filenames, e.g. `Varve-0.1.0-linux-x86_64.deb`.
 *
 * Taken from `tauri.conf.json`'s `productName`, with a trailing " Desktop"
 * removed — the installer is the product, and "Varve Desktop-0.1.0-…" reads
 * like a mistake. Spaces become hyphens so the filename stays shell-safe.
 */
export function productSlug() {
  const conf = JSON.parse(
    readFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf-8'),
  );
  const name = String(conf.productName ?? '').trim();
  if (!name) throw new Error('tauri.conf.json has no productName');
  return name.replace(/\s+Desktop$/i, '').replace(/\s+/g, '-');
}

/**
 * `owner/repo` for building release URLs.
 *
 * Order matters: CI's `GITHUB_REPOSITORY` is authoritative when present, then
 * the git remote — which GitHub updates automatically when a repository is
 * renamed, so this keeps working without anyone editing a constant.
 */
export function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;

  let url;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(
      'Cannot determine the repository: no GITHUB_REPOSITORY and no git remote "origin". ' +
        'Pass --repo owner/name explicitly.',
    );
  }

  // git@github.com:owner/repo.git | https://github.com/owner/repo(.git)
  const match = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Could not parse a repository slug from remote URL: ${url}`);
  return match[1];
}

/**
 * Document file extension without the dot, e.g. `strata`.
 *
 * Read from `bundle.fileAssociations` so release notes describe the format the
 * build actually registers, rather than a string that survives a rename.
 */
export function documentExtension() {
  const conf = JSON.parse(
    readFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf-8'),
  );
  return conf.bundle?.fileAssociations?.[0]?.ext?.[0] ?? 'strata';
}
