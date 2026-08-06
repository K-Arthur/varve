/**
 * Shared builder for the website's release data (download page input).
 *
 * Used by two producers:
 *
 *   - scripts/release/update-website-manifest.mjs — offline mode, from a
 *     locally merged release manifest (rehearsal / non-CI use)
 *   - scripts/release/fetch-website-release.mjs — CI mode, from the exact
 *     published GitHub Release (release.published -> Pages deploy)
 *
 * Both write apps/website/src/data/release-manifest.json. Everything the
 * download page shows — versions, filenames, sizes, hashes, URLs — is derived
 * here from bytes that were either built or fetched; nothing is hand-typed.
 */
import { productSlug } from './product.mjs';

/** Copy for each installer format, keyed by the manifest `format` field. */
export function formatCopy(product) {
  return {
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
  };
}

/**
 * Build the website release manifest from a verified release manifest plus the
 * release's checksum file and SBOM asset list.
 *
 * @param {object} options
 * @param {string} options.repo   owner/name of the repository
 * @param {string} options.tag    release tag (e.g. v0.1.0)
 * @param {object} options.manifest  parsed release-manifest.json from the release
 * @param {string} options.checksumsText  raw SHA256SUMS.txt from the release
 * @param {string[]} [options.sbomFilenames] SBOM asset filenames on the release
 * @param {string} [options.integrity] 'verified' when manifest and checksums agree
 * @returns {object} the website release data object
 */
export function buildWebsiteReleaseData({
  repo,
  tag,
  manifest,
  checksumsText,
  sbomFilenames = [],
  integrity = 'verified',
}) {
  const product = productSlug();
  const copy = formatCopy(product);
  const base = `https://github.com/${repo}/releases/download/${tag}`;

  // The checksum file is the ground truth for what is actually published. An
  // artifact that is in the manifest but not in SHA256SUMS.txt (or whose hash
  // differs) must never reach the download page.
  const checksums = new Map();
  for (const line of checksumsText.split('\n')) {
    const match = line.match(/^([0-9a-f]{64})\s\s(.+)$/);
    if (match) checksums.set(match[2], match[1]);
  }

  const knownFormats = new Set(Object.keys(copy));
  const platforms = {};
  const sbomByPlatform = new Map();
  for (const filename of sbomFilenames) {
    const match = filename.match(/-sbom-([a-z]+)-([a-z0-9_]+)\.cdx\.json$/);
    if (match) sbomByPlatform.set(match[1], filename);
  }

  const combinedSbom = sbomFilenames.find((f) => f.endsWith('-sbom.cdx.json'));
  const sbomFor = (os) => {
    const platformSpecific = sbomByPlatform.get(os);
    return platformSpecific ?? combinedSbom ?? null;
  };

  for (const artifact of manifest.artifacts ?? []) {
    if (!knownFormats.has(artifact.format)) {
      throw new Error(
        `Release asset ${artifact.filename} has unknown format "${artifact.format}" — ` +
          `refusing to advertise it. Known formats: ${[...knownFormats].join(', ')}`,
      );
    }
    if (!artifact.sha256 || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error(`Release asset ${artifact.filename} has no valid sha256 in the manifest`);
    }
    const publishedHash = checksums.get(artifact.filename);
    if (publishedHash !== artifact.sha256) {
      throw new Error(
        `Release asset ${artifact.filename}: manifest hash ${artifact.sha256} does not match ` +
          `SHA256SUMS.txt hash ${publishedHash ?? '(absent)'}`,
      );
    }

    const sbomName = sbomFor(artifact.os);
    platforms[artifact.os] ??= [];
    platforms[artifact.os].push({
      ...artifact,
      url: `${base}/${encodeURIComponent(artifact.filename)}`,
      sbomUrl: sbomName ? `${base}/${encodeURIComponent(sbomName)}` : null,
      ...copy[artifact.format],
    });
  }

  for (const list of Object.values(platforms)) {
    list.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  return {
    schemaVersion: 2,
    hasRelease: true,
    version: manifest.version,
    tag,
    releaseDate: manifest.generatedAt.slice(0, 10),
    prerelease: tag.includes('-'),
    signed: manifest.signed === true,
    notarized: manifest.notarized === true,
    integrity,
    releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    checksumsUrl: `${base}/SHA256SUMS.txt`,
    sbomUrl: combinedSbom
      ? `${base}/${encodeURIComponent(combinedSbom)}`
      : `${base}/${product.toLowerCase()}-${manifest.version}-sbom.cdx.json`,
    platforms,
  };
}

/** The honest no-release state, written before any release exists. */
export function emptyWebsiteReleaseData(repo) {
  return {
    schemaVersion: 2,
    hasRelease: false,
    note:
      'GENERATED FILE — do not hand-edit. Written by scripts/release/update-website-manifest.mjs ' +
      'or scripts/release/fetch-website-release.mjs. Until a release is published, hasRelease ' +
      'stays false and the download page says so rather than advertising builds that do not exist.',
    version: null,
    tag: null,
    releaseDate: null,
    prerelease: true,
    signed: false,
    notarized: false,
    integrity: null,
    releaseUrl: `https://github.com/${repo}/releases`,
    checksumsUrl: null,
    sbomUrl: null,
    platforms: {},
  };
}
