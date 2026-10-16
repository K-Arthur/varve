import release from '../data/release-manifest.json';
import { publishedFeatureVersion } from './feature-release';

type PublishedRelease = { hasRelease: boolean; version?: string; updater?: boolean };

/**
 * GitHub owner that published historical tags (v0.5.0, v0.2.1, …).
 * Those release URLs must keep resolving before a repository transfer;
 * GitHub redirects the same paths after the move.
 */
export const PUBLISHED_RELEASE_REPOSITORY = 'https://github.com/K-Arthur/varve';

/** Prepared changelog notes do not establish installer or release-link availability. */
export function changelogReleaseState(version: string, manifest: PublishedRelease = release) {
  const published = publishedFeatureVersion(version, manifest) !== null;
  return {
    published,
    latest: published && manifest.version === version,
    releaseUrl: published ? `${PUBLISHED_RELEASE_REPOSITORY}/releases/tag/v${version}` : null,
  };
}

/** This packaging defect was verified for 0.2.1, not for every future AppImage. */
export function appImageOnnxPackagingNotice(manifest: PublishedRelease = release): string | null {
  if (!manifest.hasRelease || manifest.version !== '0.2.1') return null;
  return 'Published v0.2.1 AppImages omit the bundled native ONNX Runtime because of a packaging defect, so native AI features fall back there. Use the .deb on ChromeOS.';
}

/** Pruning invalidated the published 0.2.1 signatures; later feeds require fresh verification. */
export function appImageUpdaterSignatureNotice(
  manifest: PublishedRelease = release,
): string | null {
  if (!manifest.hasRelease || !manifest.updater || manifest.version !== '0.2.1') return null;
  return 'Published v0.2.1 AppImage updater signatures do not match the files.';
}
