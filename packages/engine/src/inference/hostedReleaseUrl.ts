/**
 * GitHub Releases URL for a Varve-hosted model asset.
 *
 * Published model tags (`models-v1`, `varve-models-v1`) already exist. After a
 * repository transfer those download URLs keep working via GitHub's redirect,
 * so the default owner stays the original slug unless CI / a build override
 * supplies the current repository.
 *
 * Resolution order:
 *   1. `VARVE_GITHUB_REPOSITORY`
 *   2. `GITHUB_REPOSITORY` (Actions)
 *   3. `K-Arthur/varve` (published asset owner; redirects after transfer)
 */
const PUBLISHED_MODEL_REPO = 'K-Arthur/varve';
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function envRepo(): string | undefined {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const value = env?.VARVE_GITHUB_REPOSITORY || env?.GITHUB_REPOSITORY;
  if (value && REPO_SLUG.test(value)) return value;
  return undefined;
}

export function varveGitHubRepo(): string {
  return envRepo() ?? PUBLISHED_MODEL_REPO;
}

export function varveHostedReleaseUrl(tag: string, filename: string): string {
  return `https://github.com/${varveGitHubRepo()}/releases/download/${tag}/${filename}`;
}
