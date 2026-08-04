#!/usr/bin/env node
/**
 * Write the website's release data from a generated release manifest.
 *
 * Replaces the hand-maintained apps/website/public/releases.json, whose sizes
 * ("~200 MB"), version ("0.0.0") and AUR command ("yay -S varve-desktop", a
 * package that does not exist) were all guesses that nothing kept true — and
 * which the download page never actually read anyway.
 *
 * Everything here is derived: filenames, sizes and checksums come from the
 * bytes that were built, and download URLs are computed from the tag.
 *
 * Usage:
 *   node scripts/release/update-website-manifest.mjs \
 *     --manifest dist/release/release-manifest.json \
 *     --tag v0.1.0 \
 *     [--repo K-Arthur/varve]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productSlug, repoSlug } from './product.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(repoRoot, 'apps/website/src/data/release-manifest.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

const formatCopy = (product) => ({
  appimage: {
    title: 'AppImage',
    blurb: 'Single file, runs on any x86-64 Linux. No install, no root.',
    caveat: 'Requires FUSE2. On systems without it, run with --appimage-extract-and-run.',
    install: `chmod +x ${product}-*.AppImage && ./${product}-*.AppImage`,
  },
  deb: {
    title: 'Debian package',
    blurb: 'For Debian 12+ and Ubuntu 22.04+.',
    install: `sudo apt install ./${product}-*.deb`,
  },
  rpm: {
    title: 'RPM package',
    blurb: 'For Fedora and RHEL-based distributions.',
    install: `sudo dnf install ./${product}-*.rpm`,
  },
  nsis: {
    title: 'Windows installer',
    blurb: 'Installs for the current user. No administrator rights needed.',
    caveat:
      'Unsigned: Windows will show "Windows protected your PC". Choose More info, then Run anyway.',
    install: 'Run the downloaded .exe',
  },
  msi: {
    title: 'Windows MSI',
    blurb: 'System-wide install. Requires administrator rights.',
    install: 'Run the downloaded .msi',
  },
  dmg: {
    title: 'macOS disk image',
    blurb: 'Apple Silicon.',
    caveat:
      'Unsigned and not notarised: macOS will refuse to open it. Use System Settings > Privacy & Security > Open Anyway. Do not disable Gatekeeper.',
    install: `Open the .dmg and drag ${product} to Applications`,
  },
});

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo ?? repoSlug();
  const tag = args.tag;
  if (!tag) throw new Error('--tag is required (e.g. --tag v0.1.0)');

  const manifest = JSON.parse(readFileSync(resolve(repoRoot, args.manifest), 'utf-8'));
  const base = `https://github.com/${repo}/releases/download/${tag}`;

  const product = productSlug();
  const FORMAT_COPY = formatCopy(product);
  const platforms = {};
  for (const artifact of manifest.artifacts) {
    platforms[artifact.os] ??= [];
    platforms[artifact.os].push({
      ...artifact,
      url: `${base}/${encodeURIComponent(artifact.filename)}`,
      ...FORMAT_COPY[artifact.format],
    });
  }

  // Stable order so a rebuild does not produce a spurious diff.
  for (const list of Object.values(platforms)) {
    list.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  const website = {
    schemaVersion: 1,
    // `hasRelease: false` is a real state the page must render honestly. Before
    // the first tag there is nothing to download, and a download page that
    // implies otherwise is the single most damaging thing it can do.
    hasRelease: true,
    version: manifest.version,
    tag,
    releaseDate: manifest.generatedAt.slice(0, 10),
    prerelease: tag.includes('-'),
    signed: manifest.signed === true,
    notarized: manifest.notarized === true,
    releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    checksumsUrl: `${base}/SHA256SUMS.txt`,
    sbomUrl: `${base}/${productSlug().toLowerCase()}-${manifest.version}-sbom.cdx.json`,
    platforms,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(website, null, 2)}\n`);

  process.stdout.write(`Website release data written to ${OUT}\n`);
  for (const [os, list] of Object.entries(platforms)) {
    process.stdout.write(`  ${os}: ${list.map((a) => a.format).join(', ')}\n`);
  }
  process.stdout.write(
    '\nCommit this file and let website-deploy.yml publish it, or run the deploy manually.\n',
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
