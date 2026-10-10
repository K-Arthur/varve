#!/usr/bin/env node
/**
 * Resolve which release tag the MSIX workflow should package.
 *
 * Dispatch can target any existing release tag (including v0.5.0). An empty
 * input means the latest published GitHub release. Tag-push events use the
 * pushed tag. The job never uploads to the GitHub Release — it only builds
 * workflow artifacts.
 */
export function resolveMsixSourceTag({
  eventName,
  dispatchTag = '',
  refName = '',
  latestReleaseTag = '',
} = {}) {
  if (eventName === 'workflow_dispatch') {
    const requested = String(dispatchTag ?? '').trim();
    if (requested) return requested;
    const latest = String(latestReleaseTag ?? '').trim();
    if (!latest) throw new Error('latest GitHub release tag is unavailable');
    return latest;
  }
  if (eventName === 'push') {
    const tag = String(refName ?? '').trim();
    if (!tag.startsWith('v')) throw new Error(`expected a version tag, got ${refName}`);
    return tag;
  }
  throw new Error(`MSIX workflow does not handle event ${eventName}`);
}

export function assertReleaseTag(tag) {
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`not a Varve release tag: ${tag}`);
  }
  return tag;
}
