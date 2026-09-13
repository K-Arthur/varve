/**
 * Mockup decoration for export-shaped hosts (raster export, SVG/PDF flatten
 * boundaries, thumbnails). Keeps one implementation of "collect live source
 * ids → flatten → decorate → settle baked surface pixels → warn about missing
 * surfaces" so every export route renders the same mockup the canvas shows.
 *
 * Export decoration deliberately disables the stale last-good preview
 * fallback: an export must never present obsolete pixels as a current
 * result. Missing surfaces are reported to the caller instead.
 */

import { getImageCache, type RenderItem } from '@varve/engine';
import { type Document, isMockupFrame, type NodeId } from '@varve/scene';
import { decoratePerspectiveImages } from '../perspectiveImage';
import { replayStructuredScene } from '../replayScene';
import { decorateMockupIr, type MockupMissingSurface, MockupSurfaceCache } from './mockupIr';

let exportSurfaceCache: MockupSurfaceCache | null = null;

function getExportSurfaceCache(): MockupSurfaceCache {
  if (!exportSurfaceCache) exportSurfaceCache = new MockupSurfaceCache();
  return exportSurfaceCache;
}

/** Release cached export surface rasters (call between export runs). */
export function clearMockupExportCache(): void {
  exportSurfaceCache?.clear();
  exportSurfaceCache = null;
}

/** Live-bound source node ids of the given mockup frames. */
export function collectMockupLiveSourceIds(doc: Document, rootIds: readonly NodeId[]): NodeId[] {
  const ids: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const id of rootIds) {
    const node = doc.nodes[id];
    if (!isMockupFrame(node)) continue;
    for (const binding of Object.values(node.mockup.surfaceBindings)) {
      if (binding.mode === 'live' && binding.nodeId && !seen.has(binding.nodeId)) {
        seen.add(binding.nodeId);
        ids.push(binding.nodeId);
      }
    }
  }
  return ids;
}

/** True when the subtree contains a mockup frame or a perspective image fill. */
export function subtreeNeedsDecoration(doc: Document, rootIds: readonly NodeId[]): boolean {
  for (const id of rootIds) {
    const node = doc.nodes[id];
    if (isMockupFrame(node)) return true;
    if (
      node?.kind === 'shape' &&
      node.fills?.some((fill) => fill.type === 'image' && fill.image?.perspective !== undefined)
    ) {
      return true;
    }
  }
  return false;
}

export interface DecorateMockupSubtreeInput {
  doc: Document;
  /** Root node ids in the flattened order (frame first, then live sources). */
  rootIds: readonly NodeId[];
  flattenedIds: readonly string[];
  /** Render IR parallel to `flattenedIds`. Mutated in place for perspective. */
  items: RenderItem[];
  qualityScale: number;
  /** Emit mockup extras into `items` instead of only the extras map. */
  insertIntoList?: boolean;
}

export interface DecorateMockupSubtreeResult {
  extrasByNodeId: Map<NodeId, RenderItem[]>;
  missingSurfaces: MockupMissingSurface[];
  /** True when a mockup or perspective decoration was applied. */
  decorated: boolean;
}

export function decorateMockupSubtree(
  input: DecorateMockupSubtreeInput,
): DecorateMockupSubtreeResult {
  const { doc, rootIds, flattenedIds, items, qualityScale, insertIntoList = false } = input;
  const extrasByNodeId = new Map<NodeId, RenderItem[]>();
  const missingSurfaces: MockupMissingSurface[] = [];
  let decorated = false;

  if (rootIds.some((id) => isMockupFrame(doc.nodes[id]))) {
    const result = decorateMockupIr({
      doc,
      nodeIds: rootIds,
      items,
      renderSubtree: (ctx, nodeId) => {
        replayStructuredScene(ctx, {
          document: doc,
          rootIds: [nodeId],
          flattenedIds,
          items,
          quality: 'export',
        });
      },
      qualityScale,
      cache: getExportSurfaceCache(),
      insertIntoList,
      allowStalePreview: false,
    });
    for (const [frameId, extras] of result.extrasByNodeId) extrasByNodeId.set(frameId, extras);
    missingSurfaces.push(...result.missingSurfaces);
    decorated = true;
  }

  // Perspective (four-corner) image decoration for the export path. Runs
  // after mockup decoration (insertIntoList:false keeps `items` in 1:1
  // correspondence with rootIds), so image items with a `perspective` quad
  // are replaced by `warpedImage` primitives.
  decoratePerspectiveImages({ doc, nodeIds: rootIds, items, qualityScale });
  return { extrasByNodeId, missingSurfaces, decorated };
}

/**
 * Await decode of every image surface emitted by mockup decoration (baked
 * data URLs are created after the export resource barrier, so they are not
 * covered by `settleEngineImageResources`). Returns after every load settles;
 * failures are left to the replay placeholder path.
 */
export async function settleMockupSurfaces(
  extrasByNodeId: Map<NodeId, readonly RenderItem[]>,
): Promise<void> {
  const cache = getImageCache();
  const loads: Promise<unknown>[] = [];
  for (const items of extrasByNodeId.values()) {
    for (const item of items) {
      const primitive = item.primitive as { kind?: string; src?: string };
      if (primitive?.kind === 'warpedImage' && primitive.src) {
        loads.push(cache.load(primitive.src).catch(() => undefined));
      }
      for (const fill of item.fills ?? []) {
        if (fill.type === 'image' && fill.src) {
          loads.push(cache.load(fill.src).catch(() => undefined));
        }
      }
    }
  }
  await Promise.all(loads);
}

/** Human-readable export warning for a missing mockup surface. */
export function missingSurfaceWarning(surface: MockupMissingSurface): string {
  const reason =
    surface.reason === 'source-missing'
      ? 'its linked source no longer exists'
      : surface.reason === 'asset-missing'
        ? 'its embedded snapshot image is missing'
        : 'no source is assigned';
  return `Mockup surface “${surface.surfaceName}” was exported with a placeholder: ${reason}. Reconnect or replace the source and export again.`;
}
