/**
 * Export resource readiness — the canonical raster dependency collector and
 * settlement barrier for every structural export path.
 *
 * Export replay must never begin before the complete set of required image
 * resources for the export snapshot has reached a terminal state. A
 * resource is *settled* when it is loaded, permanently failed, or timed
 * out — never "wait forever". This module:
 *
 * 1. collects every image dependency of a flattened engine scene (image
 *    fills, patterns, warped images, alpha masks) — the same traversal
 *    shape the worker bitmap collector uses, so live render, export, and
 *    thumbnails cannot drift;
 * 2. resolves resource handles to loadable cache sources;
 * 3. waits for settlement with a bounded timeout and cancellation;
 * 4. classifies permanent failures with the typed error model so preflight
 *    UX can distinguish missing, corrupt, CORS, permission, and
 *    unavailable resources.
 */
import type { SceneNode as EngineNode } from '@varve/engine';
import { getImageCache, type ImageErrorCode, ImageLoadError } from '@varve/engine';
import { isHandleShaped, resolveSourcesForLoad } from '../render/collectImageBitmaps';

/** One required image dependency of an export snapshot. */
export interface RequiredImageResource {
  /** The IR identity (may be a canonical resource handle). */
  identity: string;
  /** Loadable cache source after handle resolution. */
  loadable: string;
  /** Human-readable context (node id + role) for preflight messaging. */
  context: string;
  /** True when the identity is a handle the registry cannot resolve: missing. */
  unresolved?: boolean;
}

/** A permanently failed resource with its typed cause. */
export interface FailedResource {
  resource: RequiredImageResource;
  code: ImageErrorCode;
  message: string;
}

export type ResourceSettlement =
  | { status: 'ready' }
  | { status: 'failed'; failures: FailedResource[] }
  | { status: 'timeout'; pending: RequiredImageResource[]; failures: FailedResource[] }
  | { status: 'cancelled' };

export interface SettleOptions {
  /** Bounded wait; pending resources are reported, not waited on forever. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_SETTLE_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 40;

function contextOf(node: EngineNode, role: string): string {
  return `${node.id ?? '<node>'}:${role}`;
}

/**
 * Collect every image resource an engine scene needs to render: image
 * fills (including their alpha masks), pattern tiles, warped-image
 * primitives, and node-level masks. Handles are resolved to loadable
 * sources; a handle-shaped identity the registry cannot resolve is
 * reported as missing rather than silently dropped.
 */
export function collectEngineImageResources(nodes: readonly EngineNode[]): RequiredImageResource[] {
  const seen = new Set<string>();
  const resources: RequiredImageResource[] = [];

  const push = (identity: string, context: string): void => {
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    resources.push({ identity, loadable: identity, context });
  };

  for (const node of nodes) {
    for (const fill of node.fills ?? []) {
      if (fill.visible === false) continue;
      if (fill.type === 'image' && fill.image?.src) {
        // Animated-media fills render through the session frame cache, not
        // ImageCache — waiting on (or loading) the encoded bytes here is
        // wasteful and can time out on large files.
        if (fill.image.frame !== undefined) continue;
        push(fill.image.src, contextOf(node, 'image-fill'));
      }
      if (fill.type === 'pattern' && fill.pattern?.tileSrc) {
        push(fill.pattern.tileSrc, contextOf(node, 'pattern'));
      }
    }
    // Node-level alpha masks (background removal / native raster masks) are
    // propagated onto image FillIRs by buildIr; at the engine-node level
    // they live here.
    if (node.alphaMask) push(node.alphaMask, contextOf(node, 'node-mask'));
    const primitive = node.shape as { kind?: string; src?: string } | undefined;
    if (primitive?.kind === 'warpedImage' && primitive.src) {
      push(primitive.src, contextOf(node, 'warped-image'));
    }
  }

  const resolved = resolveSourcesForLoad(resources.map((r) => r.identity));
  if (resolved === null) {
    // A handle-shaped identity is not registered: that resource is missing.
    // Keep every other dependency in the set so preflight reports the full
    // snapshot, marking only the unresolvable entries.
    return resources.map((resource) =>
      isHandleShaped(resource.identity) ? { ...resource, unresolved: true } : resource,
    );
  }
  return resources.map((resource, index) => ({
    ...resource,
    loadable: resolved[index] as string,
  }));
}

/** Classify a failed resource from its cache entry. */
function failureOf(resource: RequiredImageResource): FailedResource {
  if (resource.unresolved) {
    return {
      resource,
      code: 'missing',
      message: `Image asset ${resource.identity} is not present in the document`,
    };
  }
  const entry = getImageCache().get(resource.loadable);
  const error = entry?.error;
  const code: ImageErrorCode =
    error instanceof ImageLoadError && error.code ? error.code : 'unknown';
  return {
    resource,
    code,
    message:
      error?.message ??
      (code === 'missing' ? 'Image resource is missing' : 'Image resource failed to load'),
  };
}

function isSettled(resource: RequiredImageResource): 'ready' | 'failed' | 'pending' {
  if (resource.unresolved) return 'failed';
  if (getImageCache().isLoaded(resource.loadable)) return 'ready';
  const state = getImageCache().state(resource.loadable);
  if (state === 'error') return 'failed';
  return 'pending';
}

/**
 * Wait for every required resource to settle (loaded or permanently
 * failed), then report the outcome. A resource still loading after
 * `timeoutMs` is reported as pending — a transient, explicit failure that
 * never blocks export forever. Permanent failures are classified with the
 * typed error model; the caller decides fail-vs-continue policy.
 */
export async function settleEngineImageResources(
  nodes: readonly EngineNode[],
  options: SettleOptions = {},
): Promise<ResourceSettlement> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  const resources = collectEngineImageResources(nodes);

  const results = new Map<string, 'ready' | 'failed' | 'pending'>(
    resources.map((r) => [r.identity, isSettled(r)]),
  );

  // Kick every pending load once; failures land in the cache error state.
  for (const resource of resources) {
    if (results.get(resource.identity) === 'pending') {
      getImageCache()
        .load(resource.loadable)
        .catch(() => {
          /* errors recorded in the cache entry */
        });
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (options.signal?.aborted) return { status: 'cancelled' };
    let anyPending = false;
    for (const resource of resources) {
      const state = isSettled(resource);
      if (state !== 'pending') results.set(resource.identity, state);
      if (state === 'pending') anyPending = true;
    }
    if (!anyPending) break;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const failures: FailedResource[] = [];
  const pending: RequiredImageResource[] = [];
  for (const resource of resources) {
    const state = results.get(resource.identity) ?? isSettled(resource);
    if (state === 'failed') failures.push(failureOf(resource));
    if (state === 'pending') pending.push(resource);
  }

  if (failures.length === 0 && pending.length === 0) return { status: 'ready' };
  if (pending.length > 0) return { status: 'timeout', pending, failures };
  return { status: 'failed', failures };
}

/**
 * User-facing recovery hint per failure code, matching the typed error
 * model. Retry is deliberately absent where it cannot change the outcome.
 */
export function recoveryHintFor(code: ImageErrorCode): string {
  switch (code) {
    case 'missing':
      return 'Relink or replace the image file, then export again.';
    case 'corrupt':
    case 'unsupported':
      return 'Replace the damaged file with a valid image, then export again.';
    case 'permission':
      return 'Grant file access to the image, or replace it, then export again.';
    case 'cors':
      return 'This image can display but cannot be exported. Replace it with an embedded local copy.';
    case 'unavailable':
      return 'The image source is temporarily unreachable; retry when it is back online.';
    default:
      return 'Replace the image, then export again.';
  }
}

/** One-line export warning for a failed resource (explicit, not silent). */
export function failureWarning(failure: FailedResource): string {
  const name = failure.resource.context;
  return `Export skipped image (${name}): ${failure.message} — ${recoveryHintFor(failure.code)}`;
}
