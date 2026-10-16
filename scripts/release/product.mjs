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

/** `owner/repo` as GitHub accepts it. Rejects `.` / `..` path segments. */
export const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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

/** Throw unless `value` is a GitHub `owner/repo` slug. */
export function assertRepoSlug(value) {
  const slug = String(value ?? '');
  if (
    !REPO_SLUG_PATTERN.test(slug) ||
    slug.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid GitHub repository slug: ${value}`);
  }
  return slug;
}

/**
 * `owner/repo` for building release URLs.
 *
 * Order matches the model-asset resolver in `hostedReleaseUrl.ts`:
 *   1. `VARVE_GITHUB_REPOSITORY` (explicit override)
 *   2. `GITHUB_REPOSITORY` (Actions)
 *   3. git `origin` remote (GitHub updates this on transfer/rename)
 */
export function repoSlug({ env = process.env, gitCwd = repoRoot } = {}) {
  const override = String(env.VARVE_GITHUB_REPOSITORY ?? '').trim();
  if (override) return assertRepoSlug(override);
  const fromCi = String(env.GITHUB_REPOSITORY ?? '').trim();
  if (fromCi) return assertRepoSlug(fromCi);

  let url;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: gitCwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(
      'Cannot determine the repository: no VARVE_GITHUB_REPOSITORY, no GITHUB_REPOSITORY, and no git remote "origin". ' +
        'Pass --repo owner/name explicitly.',
    );
  }

  // git@github.com:owner/repo.git | https://github.com/owner/repo(.git)
  const match = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Could not parse a repository slug from remote URL: ${url}`);
  return assertRepoSlug(match[1]);
}

/**
 * HTTPS GitHub Releases download base for a tag (`v0.5.1` or `0.5.1`).
 *
 * Used by updater-feed generation and release hints so a transfer to another
 * owner does not require editing a hardcoded `owner/repo` string.
 */
export function releaseDownloadBaseUrl(tagOrVersion) {
  const tag = String(tagOrVersion).startsWith('v') ? tagOrVersion : `v${tagOrVersion}`;
  return `https://github.com/${repoSlug()}/releases/download/${tag}`;
}

/** HTTPS GitHub repository URL (`https://github.com/owner/repo`). */
export function repoHttpsUrl() {
  return `https://github.com/${repoSlug()}`;
}

/**
 * Document file extension without the dot, e.g. `varve`.
 *
 * Read from `bundle.fileAssociations` so release notes describe the format the
 * build actually registers, rather than a string that survives a rename.
 */
export function documentExtension() {
  const conf = JSON.parse(
    readFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf-8'),
  );
  return conf.bundle?.fileAssociations?.[0]?.ext?.[0] ?? 'varve';
}
