/**
 * screenRender — prototype presentation screen rendering.
 *
 * Renders a frame (screen) subtree through the canonical pipeline —
 * `flattenSceneToEngine` with `localTransforms` (the frame's children render
 * in frame-local space, as if the frame were at the origin) followed by the
 * engine's `generateThumbnail` IR replay. This is the same conversion the
 * canvas and thumbnail system use; the presenter must never hand-roll a
 * mini-renderer.
 *
 * Results are cached per screenId+document-revision+size (LRU) so overlay
 * stack changes and hotspot hover recomputes don't re-render the screen.
 * In environments without canvas/encoding (jsdom) the engine returns a
 * placeholder — the caller renders hotspots only, which keeps presentation
 * tests meaningful without a raster path.
 */
import { generateThumbnail } from '@varve/engine';
import type { Document, NodeId } from '@varve/scene';
import { flattenSceneToEngine } from '../../render/sceneToEngine';
import { documentRevisionHash } from '../../thumbnail/identity';

const CACHE_MAX = 12;
const screenRenderCache = new Map<string, Promise<string | null>>();

/** Render a prototype screen (frame) to a PNG data URL, or null when the
 *  environment has no raster path. Cached; safe to call per render. */
export function renderScreenToDataUrl(
  document: Document,
  screenId: NodeId,
  width: number,
  height: number,
): Promise<string | null> {
  const rev = documentRevisionHash(document);
  const key = `${screenId}:${rev}:${Math.round(width)}x${Math.round(height)}`;
  const cached = screenRenderCache.get(key);
  if (cached) return cached;

  const pending = (async (): Promise<string | null> => {
    const { nodes } = flattenSceneToEngine(document, [screenId], { localTransforms: true });
    if (nodes.length === 0) return null;
    const result = await generateThumbnail(nodes, rev, {
      maxWidth: Math.max(1, Math.round(width)),
      maxHeight: Math.max(1, Math.round(height)),
      fit: 'fill',
      format: 'png',
      background: { type: 'transparent' },
      devicePixelRatio: 2,
    });
    return result?.dataUrl || null;
  })().catch(() => null);

  screenRenderCache.set(key, pending);
  if (screenRenderCache.size > CACHE_MAX) {
    const oldest = screenRenderCache.keys().next().value;
    if (oldest !== undefined) screenRenderCache.delete(oldest);
  }
  return pending;
}

/** Clear the presentation cache (document replaced, tests). */
export function clearScreenRenderCache(): void {
  screenRenderCache.clear();
}
