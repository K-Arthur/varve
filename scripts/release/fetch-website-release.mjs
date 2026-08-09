#!/usr/bin/env node
/**
 * Fetch the published release data and rewrite the website's download-page
 * manifest from it.
 *
 * This is the connection between the release pipeline and the website: on the
 * `release.published` event, website-deploy.yml runs this script, which reads
 * the exact published release (not the "latest" endpoint, not a committed
 * snapshot) and verifies its integrity before a single download card is
 * rendered. The committed release-manifest.json is only ever a fallback for
 * the no-release state and local dev.
 *
 * Channel policy (explicit and documented, not "latest release"):
 *
 *   1. Only PUBLISHED releases are eligible; drafts and deleted releases never
 *      appear on the download page.
 *   2. The highest semver STABLE release (non-prerelease tag) wins.
 *   3. If no stable release exists, the highest semver PRERELEASE is shown,
 *      clearly labelled as a preview.
 *   4. --tag pins a specific tag (used by the release rehearsal), but still
 *      refuses to advertise a draft or withdrawn release.
 *
 * Verification performed before anything is written:
 *   - the release-manifest.json asset exists and parses
 *   - manifest.version agrees with the tag
 *   - every manifest artifact has a 64-char lowercase SHA-256
 *   - every manifest artifact appears in SHA256SUMS.txt with the SAME hash
 *   - artifact formats are a known, supported set
 *   - the release has no extra unmanifested installer-like assets
 *
 * Any failure exits non-zero: the deploy fails rather than rendering invented
 * data. A transient API failure (rate limit, network) also fails the deploy —
 * an explicit error beats a page that silently claims "no release" when one
 * exists.
 *
 * Usage:
 *   node scripts/release/fetch-website-release.mjs \
 *     [--repo K-Arthur/varve] [--tag v0.1.0] [--token <github token>]
 *
 * GITHUB_TOKEN environment variable is used when --token is absent. A token is
 * strongly recommended: the unauthenticated rate limit (60 req/h) is
 * insufficient for a busy release day.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoSlug } from './product.mjs';
import { selectRelease, verifyReleaseIntegrity } from './verify-release-data.mjs';
import { buildWebsiteReleaseData, emptyWebsiteReleaseData } from './website-release-data.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(repoRoot, 'apps/website/src/data/release-manifest.json');
const API = 'https://api.github.com';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

async function gh(url, token) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'varve-release-fetch',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub API rate-limited or forbidden (HTTP ${res.status}) fetching ${url}`);
  }
  if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching ${url}`);
  return res;
}

async function download(url, token) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'varve-release-fetch',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token ?? process.env.GITHUB_TOKEN ?? '';
  const repo = args.repo ?? repoSlug();
  const pinnedTag = args.tag ?? null;
  // 1. Channel policy: published stable > published prerelease > no release.
  //    Drafts (and withdrawn releases, which GitHub keeps as drafts) never
  //    appear on the download page.
  let releases;
  try {
    const res = await gh(`${API}/repos/${repo}/releases?per_page=100`, token);
    releases = await res.json();
  } catch (err) {
    process.stderr.write(`release data fetch failed: ${err.message}\n`);
    process.exit(1);
  }

  const release = selectRelease(releases, pinnedTag);
  if (!release) {
    if (pinnedTag) {
      process.stderr.write(
        `Tag ${pinnedTag} exists but is not a published release (draft or withdrawn). ` +
          'Drafts never appear on the public download page.\n',
      );
      process.exit(1);
    }
    // Honest no-release state.
    writeFileSync(OUT, `${JSON.stringify(emptyWebsiteReleaseData(repo), null, 2)}\n`);
    process.stdout.write('No published release — website keeps the no-release state.\n');
    return;
  }
  const tag = release.tag_name;
  const assets = (release.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url }));

  // 2. Download the integrity files. Missing either means the release is not
  //    complete enough to advertise — fail the deploy, never invent values.
  const manifestAsset = assets.find((a) => a.name === 'release-manifest.json');
  const checksumsAsset = assets.find((a) => a.name === 'SHA256SUMS.txt');
  if (!manifestAsset || !checksumsAsset) {
    process.stderr.write(
      `Release ${tag} is missing release-manifest.json and/or SHA256SUMS.txt. ` +
        'Refusing to render download cards for a release without its integrity files.\n',
    );
    process.exit(1);
  }

  let manifest;
  let checksumsText;
  try {
    manifest = JSON.parse((await download(manifestAsset.url, token)).toString('utf-8'));
    checksumsText = (await download(checksumsAsset.url, token)).toString('utf-8');
  } catch (err) {
    process.stderr.write(`failed to download release integrity files: ${err.message}\n`);
    process.exit(1);
  }

  // 3. Verify before use. Every check below exits non-zero on failure. The
  //    rules live in verify-release-data.mjs so they are unit-testable without
  //    a network.
  let verified;
  try {
    verified = verifyReleaseIntegrity({
      tag,
      manifest,
      checksumsText,
      assetNames: assets.map((a) => a.name),
    });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const website = buildWebsiteReleaseData({
    repo,
    tag,
    manifest,
    checksumsText,
    sbomFilenames: verified.sbomAssets,
    integrity: 'verified',
  });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(website, null, 2)}\n`);

  process.stdout.write(
    `Website release data refreshed from ${tag} (${verified.artifacts.length} artifacts, ` +
      `${verified.sbomAssets.length} SBOMs).\n`,
  );
}

try {
  await main();
} catch (err) {
  process.stderr.write(`fetch-website-release failed: ${err.message}\n`);
  process.exit(1);
}
