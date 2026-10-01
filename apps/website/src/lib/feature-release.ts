import release from '../data/release-manifest.json';

type ReleaseManifest = {
  hasRelease: boolean;
  version?: string;
};

type VersionTuple = {
  core: [number, number, number];
  prerelease: boolean;
};

function parseVersion(version: string): VersionTuple | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: Boolean(match[4]),
  };
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index]! > b.core[index]! ? 1 : -1;
  }
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  return 0;
}

/**
 * Returns the verified published release version once it includes a feature.
 * The committed release manifest is refreshed from published GitHub release
 * data by the website workflow; source-build copies therefore keep preview
 * labels until the corresponding version is actually published.
 */
export function publishedFeatureVersion(
  firstVersion: string,
  manifest: ReleaseManifest = release,
): string | null {
  if (!manifest.hasRelease || !manifest.version) return null;
  const comparison = compareVersions(manifest.version, firstVersion);
  return comparison !== null && comparison >= 0 ? manifest.version : null;
}
