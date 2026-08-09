/**
 * Editor media runtime — the adapter that binds the engine's media pipeline
 * to editor state.
 *
 * Responsibilities:
 *  - holds the current document + media time
 *  - registers sessions for animated assets (bytes from the data URL)
 *  - resolves per-usage source frames at the current media time
 *  - primes the frame cache (deduped, generation-tokened, prefetching)
 *  - computes the `presentedStamp` (redraw trigger: advances only when some
 *    usage's resolved frame changed)
 *  - installs the default sceneToEngine frame resolver so replay serves the
 *    current frame without hub-file changes
 *  - bridges frame-cache arrivals to a redraw callback (async reframe
 *    contract)
 */

import {
  defaultMediaFillSettings,
  getMediaRegistry,
  resolveUsageFrame,
  type AnimatedAssetMetadata,
  type CompositedFrame,
} from '@varve/engine';
import { isAnimatedMediaNode } from '@varve/scene';
import { setDefaultMediaFrameResolver } from '../render/sceneToEngine';
import type { Document, Fill, SceneNode } from '@varve/scene';

interface RuntimeState {
  document: Document | null;
  mediaTimeMs: number;
  lastPresented: Map<string, number>;
  redraw: (() => void) | null;
  installedResolver: boolean;
}

const state: RuntimeState = {
  document: null,
  mediaTimeMs: 0,
  lastPresented: new Map(),
  redraw: null,
  installedResolver: false,
};

/** Decode a data URL to bytes (browser + node). */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');
  const base64 = dataUrl.slice(comma + 1);
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Register sessions for every animated asset in the document. Called
 * whenever the document changes — idempotent, and a no-op for documents
 * without animated assets.
 */
export function syncMediaSessions(document: Document | null): void {
  state.document = document;
  if (!document?.assets) {
    releaseStaleMediaSessions(document);
    return;
  }
  const registry = getMediaRegistry();
  for (const [assetId, asset] of Object.entries(document.assets)) {
    const animated = asset.animated as AnimatedAssetMetadata | undefined;
    if (!animated) continue;
    if (registry.get(assetId)) continue;
    try {
      registry.acquire(assetId, dataUrlToBytes(asset.dataUrl), animated);
    } catch {
      // malformed payload — the session stays absent; the renderer shows the
      // poster fallback and the asset is surfaced as missing media
    }
  }
  releaseStaleMediaSessions(document);
}

/** Release sessions whose assets left the document (close/remove). */
export function releaseStaleMediaSessions(document: Document | null): void {
  const registry = getMediaRegistry();
  const live = new Set(Object.keys(document?.assets ?? {}));
  registry.retain(live);
}

/** Resolve the displayed source frame for one animated fill at media time. */
export function resolveFillFrame(
  _node: SceneNode,
  fill: Fill,
  document: Document | null,
  mediaTimeMs: number,
): number {
  const assetId = fill.image?.assetId;
  if (!assetId || !document?.assets) return 0;
  const asset = document.assets[assetId];
  const animated = asset?.animated as AnimatedAssetMetadata | undefined;
  if (!animated) return 0;
  const settings = fill.image?.media ?? defaultMediaFillSettings();
  const registry = getMediaRegistry();
  const session = registry.get(assetId);
  if (!session) return settings.posterFrame;
  const resolved = resolveUsageFrame(
    { settings, sourceLoopCount: animated.loopCount, timing: session.timing },
    mediaTimeMs,
  );
  return resolved.frameIndex;
}

/**
 * Advance media time, resolve every animated usage's frame, prime the cache
 * for changed frames, and return the new presented stamp. The stamp advances
 * only when some usage's resolved frame changed — a node on a long source
 * frame does not invalidate every RAF.
 */
export function tickMediaPresentation(document: Document | null, mediaTimeMs: number): number {
  state.mediaTimeMs = mediaTimeMs;
  const documentRef = document ?? state.document;
  if (!documentRef) return presentedStamp();
  const registry = getMediaRegistry();
  let changed = false;
  for (const node of Object.values(documentRef.nodes)) {
    if (!node || !isAnimatedMediaNode(node, documentRef)) continue;
    const fills = (node as { fills?: Fill[] }).fills;
    if (!fills) continue;
    fills.forEach((fill, index) => {
      if (fill?.type !== 'image' || !fill.image) return;
      const assetId = fill.image.assetId;
      if (!assetId) return;
      const session = registry.get(assetId);
      if (!session) return;
      const frame = resolveFillFrame(node, fill, documentRef, mediaTimeMs);
      const usageKey = `${assetId}:${node.id}:${index}`;
      if (state.lastPresented.get(usageKey) !== frame) {
        state.lastPresented.set(usageKey, frame);
        changed = true;
      }
      if (session.getComposited(frame)) return;
      void session.requestFrame(frame, { priority: 0 }).catch(() => {});
    });
  }
  if (changed) {
    state.lastPresented.set('__stamp', presentedStamp() + 1);
  }
  return presentedStamp();
}

function presentedStamp(): number {
  return state.lastPresented.get('__stamp') ?? 0;
}

/** Current media time (for external readers). */
export function currentMediaTime(): number {
  return state.mediaTimeMs;
}

/** Reset runtime state (document close / session teardown). */
export function resetMediaRuntime(): void {
  state.document = null;
  state.mediaTimeMs = 0;
  state.lastPresented.clear();
  state.redraw = null;
  state.installedResolver = false;
  setDefaultMediaFrameResolver(undefined);
  getMediaRegistry().clear();
}

/**
 * Install the default sceneToEngine frame resolver (playback time). All
 * replay paths without an explicit resolver (canvas, mockups) then serve
 * the current frame; export/thumbnail paths pass their own resolver.
 */
export function installMediaFrameResolver(): void {
  if (state.installedResolver) return;
  state.installedResolver = true;
  setDefaultMediaFrameResolver((_node, fill, doc) => {
    if (fill.type !== 'image' || !fill.image?.assetId) return undefined;
    const asset = doc?.assets?.[fill.image.assetId];
    if (!asset?.animated) return undefined;
    const settings = fill.image.media ?? defaultMediaFillSettings();
    const registry = getMediaRegistry();
    const session = registry.get(fill.image.assetId);
    if (!session) return settings.posterFrame;
    const resolved = resolveUsageFrame(
      {
        settings,
        sourceLoopCount: (asset.animated as AnimatedAssetMetadata).loopCount,
        timing: session.timing,
      },
      state.mediaTimeMs,
    );
    return resolved.frameIndex;
  });
}

/** Bridge media frame-cache arrivals to a canvas redraw. */
export function bridgeMediaCacheToRedraw(redraw: () => void): () => void {
  state.redraw = redraw;
  return getMediaRegistry().cache.subscribeGlobal(() => {
    state.redraw?.();
  });
}

/** Convenience for callers that need a composited frame (e.g. poster). */
export function getCompositedFrame(assetId: string, frameIndex: number): CompositedFrame | undefined {
  return getMediaRegistry().get(assetId)?.getComposited(frameIndex);
}
