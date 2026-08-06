/**
 * Pure verification of a release's integrity files — no network, no writes.
 *
 * Both producers of website release data (the offline update-website-manifest
 * and the CI fetch-website-release) and the release pipeline's final checksum
 * verification share these rules. Every rule throws with a specific message so
 * tests can assert on the exact failure.
 */

const SHA256 = /^[0-9a-f]{64}$/;

export const KNOWN_FORMATS = ['appimage', 'deb', 'rpm', 'nsis', 'msi', 'dmg'];
export const KNOWN_OS = ['linux', 'macos', 'windows'];

/**
 * Parse a SHA256SUMS.txt body.
 *
 * Deterministic format: `<64-char lowercase sha256><two spaces><filename>`.
 * Rejects wrong-length or mixed-case hashes, duplicate filenames, newlines in
 * filenames, unsafe paths and path traversal.
 *
 * @returns {Map<string, string>} filename -> lowercase sha256
 */
export function parseChecksums(text) {
  const entries = new Map();
  const seen = new Set();
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const line = raw.replace(/\r$/, '');
    if (!line.includes('  ')) {
      throw new Error(`Malformed checksum line (no two-space separator): ${JSON.stringify(line)}`);
    }
    const sep = line.indexOf('  ');
    const hash = line.slice(0, sep);
    const filename = line.slice(sep + 2);
    if (!SHA256.test(hash)) {
      throw new Error(`Invalid SHA-256 (must be 64 lowercase hex): ${JSON.stringify(hash)}`);
    }
    if (!filename || filename.length !== filename.trim().length) {
      throw new Error(`Invalid filename in checksum line: ${JSON.stringify(filename)}`);
    }
    if (filename.includes('\n') || filename.includes('\r')) {
      throw new Error(`Newline in checksum filename: ${JSON.stringify(filename)}`);
    }
    if (filename.startsWith('/') || filename.includes('..')) {
      throw new Error(`Unsafe checksum filename (path traversal): ${JSON.stringify(filename)}`);
    }
    if (seen.has(filename)) {
      throw new Error(`Duplicate filename in checksum file: ${JSON.stringify(filename)}`);
    }
    seen.add(filename);
    entries.set(filename, hash);
  }
  if (entries.size === 0) {
    throw new Error('Checksum file is empty');
  }
  return entries;
}

/**
 * Verify a release manifest against its checksum file and asset list.
 *
 * @param {object} options
 * @param {string} options.tag        release tag, e.g. v0.1.0
 * @param {object} options.manifest   parsed release-manifest.json
 * @param {string} options.checksumsText  raw SHA256SUMS.txt content
 * @param {string[]} options.assetNames   all asset filenames on the release
 * @returns {{ artifacts: object[], sbomAssets: string[] }}
 * @throws {Error} with a specific message on any integrity violation
 */
export function verifyReleaseIntegrity({ tag, manifest, checksumsText, assetNames }) {
  const version = String(tag).replace(/^v/, '');
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('release-manifest.json is missing or not an object');
  }
  if (manifest.version !== version) {
    throw new Error(
      `release-manifest.json version "${manifest.version}" does not match tag ${tag}. Refusing.`,
    );
  }

  const checksums = parseChecksums(checksumsText);
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const names = artifacts.map((a) => a.filename);

  if (new Set(names).size !== names.length) {
    throw new Error('release-manifest.json contains duplicate filenames. Refusing.');
  }

  for (const artifact of artifacts) {
    if (!artifact.filename || typeof artifact.filename !== 'string') {
      throw new Error('Artifact without a filename in release-manifest.json. Refusing.');
    }
    if (!KNOWN_FORMATS.includes(artifact.format)) {
      throw new Error(
        `Unsupported artifact format "${artifact.format}" for ${artifact.filename}. Refusing.`,
      );
    }
    if (!KNOWN_OS.includes(artifact.os)) {
      throw new Error(`Unsupported platform "${artifact.os}" for ${artifact.filename}. Refusing.`);
    }
    if (!artifact.sha256 || !SHA256.test(artifact.sha256)) {
      throw new Error(`Release asset ${artifact.filename} has no valid sha256 in the manifest`);
    }
    if (artifact.sizeBytes === undefined || Number(artifact.sizeBytes) <= 0) {
      throw new Error(
        `Release asset ${artifact.filename} has no positive sizeBytes in the manifest`,
      );
    }
    const publishedHash = checksums.get(artifact.filename);
    if (publishedHash !== artifact.sha256) {
      throw new Error(
        `Hash mismatch for ${artifact.filename}: manifest says ${artifact.sha256}, ` +
          `SHA256SUMS.txt says ${publishedHash ?? '(absent)'}. Refusing.`,
      );
    }
  }

  // Every checksum entry must name a real asset (a checksum for a phantom file
  // is how a stale file quietly validates against nothing).
  const assetSet = new Set(assetNames);
  for (const name of checksums.keys()) {
    if (name !== 'SHA256SUMS.txt' && !assetSet.has(name)) {
      throw new Error(`SHA256SUMS.txt lists ${name} which is not a release asset. Refusing.`);
    }
  }

  // No unmanifested installer-like assets may lurk on the release.
  const installerSuffixes = ['.AppImage', '.deb', '.rpm', '.exe', '.msi', '.dmg'];
  const installerAssets = assetNames.filter((name) =>
    installerSuffixes.some((s) => name.endsWith(s)),
  );
  const unmanifested = installerAssets.filter((name) => !names.includes(name));
  if (unmanifested.length > 0) {
    throw new Error(
      `Release has installer assets not listed in release-manifest.json: ` +
        `${unmanifested.join(', ')}. Refusing.`,
    );
  }

  // SBOM coverage: each advertised platform needs a platform SBOM or a combined one.
  const sbomAssets = assetNames.filter(
    (name) => name.endsWith('.cdx.json') || name.endsWith('.cdx.xml'),
  );
  for (const os of new Set(artifacts.map((a) => a.os))) {
    const hasPlatformSbom = sbomAssets.some((n) => n.includes(`-sbom-${os}-`));
    if (!hasPlatformSbom && !sbomAssets.some((n) => n.endsWith('-sbom.cdx.json'))) {
      throw new Error(
        `Release advertises ${os} but has no ${os}-specific or combined SBOM. Refusing.`,
      );
    }
  }
  for (const name of sbomAssets) {
    if (!checksums.has(name)) {
      throw new Error(`SBOM asset ${name} is not covered by SHA256SUMS.txt. Refusing.`);
    }
  }

  return { artifacts, sbomAssets };
}
