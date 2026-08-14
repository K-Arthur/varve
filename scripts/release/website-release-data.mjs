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
import { ARCHITECTURES, normalizeArchitecture, targetFor } from './targets.mjs';

/** Copy for each installer format, keyed by the manifest `format` field. */
export function formatCopy(product) {
  return {
    appimage: {
      title: 'AppImage',
      blurb:
        'Portable file for x86-64 Linux — no install, no root. Uses the system WebKitGTK ' +
        'libraries (same requirement as the .deb).',
      caveat:
        'Requires FUSE2 and a system WebKitGTK (libwebkit2gtk-4.1). On systems without ' +
        'FUSE2, run with --appimage-extract-and-run.',
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
      caveatSigned:
        'Digitally signed. Windows may still show a SmartScreen "unrecognized" warning until the ' +
        'publisher builds reputation — verify the publisher name shown before running.',
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
        'Unsigned and not notarized: macOS will refuse to open it. Use System Settings > Privacy & Security > Open Anyway. Do not disable Gatekeeper.',
      caveatSigned:
        'Signed with an Apple Developer ID and notarized by Apple. No Gatekeeper override needed.',
      install: `Open the .dmg and drag ${product} to Applications`,
    },
  };
}

/**
 * Per-platform trust copy for the download page, derived from the release's
 * signing block. The copy is chosen ONLY from verification state recorded in
 * the manifest — never from intent.
 */
export function platformTrustLabel(platform, signing = {}) {
  if (platform === 'windows') {
    const s = signing.windows;
    if (s?.signed) {
      const publisher = s.publisher ? s.publisher.replace(/^CN=/, '') : 'the verified publisher';
      return {
        badge: 'Digitally signed',
        detail: `Signature verified: ${publisher}. SmartScreen may still warn until reputation builds.`,
        signed: true,
      };
    }
    return {
      badge: 'Not code-signed',
      detail:
        'Unsigned build: Windows will show "Windows protected your PC". Choose More info, then Run anyway.',
      signed: false,
    };
  }
  if (platform === 'macos') {
    const s = signing.macos;
    if (s?.signed && s.notarized && s.stapled) {
      return {
        badge: 'Developer ID signed and notarized',
        detail: 'Signed, notarized by Apple, and the notarization ticket is stapled.',
        signed: true,
      };
    }
    if (s?.signed && !s.notarized) {
      return {
        badge: 'Signed but NOT notarized',
        detail:
          'A signature exists but Apple notarization did not verify. Treat like an unsigned build: ' +
          'macOS will refuse to open it.',
        signed: false,
      };
    }
    return {
      badge: 'Not code-signed',
      detail:
        'Unsigned and not notarized: macOS will refuse to open it. Use System Settings > Privacy & Security > Open Anyway. Do not disable Gatekeeper.',
      signed: false,
    };
  }
  return {
    badge: 'SHA-256 + provenance',
    detail:
      'Verified by SHA-256 checksum, SBOM and GitHub build provenance. Linux has no platform code-signing certificate.',
    signed: false,
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
  const sbomByTarget = new Map();
  for (const filename of sbomFilenames) {
    const match = filename.match(/-sbom-([a-z]+)-([a-z0-9_]+)\.cdx\.json$/);
    if (!match) continue;
    try {
      const architecture = normalizeArchitecture(match[2]);
      sbomByTarget.set(`${match[1]}|${architecture}`, filename);
    } catch {
      // Unknown SBOM names must not be assigned to a download on this page.
    }
  }

  const combinedSbom = sbomFilenames.find((f) => f.endsWith('-sbom.cdx.json'));
  const sbomFor = (artifact) => {
    const architecture = normalizeArchitecture(artifact.arch);
    return sbomByTarget.get(`${artifact.os}|${architecture}`) ?? combinedSbom ?? null;
  };

  for (const artifact of manifest.artifacts ?? []) {
    const target = targetFor(artifact.os, artifact.arch);
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

    const sbomName = sbomFor(artifact);
    platforms[artifact.os] ??= [];
    platforms[artifact.os].push({
      ...artifact,
      arch: target.architecture,
      architectureLabel: ARCHITECTURES[target.architecture].label,
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
    // These three are the machine-readable signing state, populated from
    // post-build cryptographic verification (see scripts/release/signing-policy.mjs).
    signed: manifest.signed === true,
    notarized: manifest.notarized === true,
    signing: manifest.signing ?? {},
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
