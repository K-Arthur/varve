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
import {
  type Document,
  getMockupTemplate,
  isMockupFrame,
  type NodeId,
  walkNodes,
} from '@varve/scene';
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
  const visitedFrames = new Set<NodeId>();
  const pendingFrames = [...subtreeNodeIds(doc, rootIds)].filter((id) =>
    isMockupFrame(doc.nodes[id]),
  );
  while (pendingFrames.length > 0) {
    const frameId = pendingFrames.pop()!;
    if (visitedFrames.has(frameId)) continue;
    visitedFrames.add(frameId);
    const node = doc.nodes[frameId];
    if (!isMockupFrame(node)) continue;
    for (const binding of Object.values(node.mockup.surfaceBindings)) {
      if (binding.mode !== 'live' || !binding.nodeId || seen.has(binding.nodeId)) continue;
      seen.add(binding.nodeId);
      ids.push(binding.nodeId);
      // A nested mockup source is a real dependency too. It is traversed
      // once here so export readiness and flattening include its live source,
      // while the visited set makes malformed cycles terminate.
      if (isMockupFrame(doc.nodes[binding.nodeId])) pendingFrames.push(binding.nodeId);
    }
  }
  return ids;
}

/** True when the subtree contains a mockup frame or a perspective image fill. */
export function subtreeNeedsDecoration(doc: Document, rootIds: readonly NodeId[]): boolean {
  for (const id of subtreeNodeIds(doc, rootIds)) {
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

export interface SettleMockupTemplateAssetsOptions {
  /** Abort the export before or between template-resource loads. */
  signal?: AbortSignal;
}

function throwIfMockupExportAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

/**
 * Decode every raster referenced by a mockup template before export replay.
 *
 * Template plates and clip/occlusion masks are document-level assets rather
 * than image-fill nodes, so `settleEngineImageResources()` cannot discover
 * them. Without this barrier the first export can draw a placeholder plate or
 * apply no mask while the canvas later becomes correct after the lazy cache
 * load. Missing or undecodable template resources therefore block export
 * with an actionable error; the stale-preview recovery path remains preview
 * only and is never used here.
 */
export async function settleMockupTemplateAssets(
  doc: Document,
  rootIds: readonly NodeId[],
  options: SettleMockupTemplateAssetsOptions = {},
): Promise<void> {
  const assets = new Map<string, string>();
  const missingTemplates: string[] = [];
  const missingAssets: string[] = [];

  for (const id of subtreeNodeIds(doc, rootIds)) {
    throwIfMockupExportAborted(options.signal);
    const node = doc.nodes[id];
    if (!isMockupFrame(node)) continue;
    const template = getMockupTemplate(doc, node.mockup.templateId);
    if (!template) {
      missingTemplates.push(`${node.id}:${node.mockup.templateId}`);
      continue;
    }

    const assetIds = new Set<string>();
    if (template.plateImage?.assetId) assetIds.add(template.plateImage.assetId);
    for (const surface of template.surfaces) {
      if (surface.clipMaskAssetId) assetIds.add(surface.clipMaskAssetId);
      if (surface.occlusionMaskAssetId) assetIds.add(surface.occlusionMaskAssetId);
    }

    for (const assetId of assetIds) {
      const asset = doc.assets?.[assetId];
      if (!asset?.dataUrl) {
        missingAssets.push(`${template.name}:${assetId}`);
        continue;
      }
      assets.set(assetId, asset.dataUrl);
    }
  }

  if (missingTemplates.length > 0) {
    throw new Error(
      `Export cannot include mockup frame(s) with missing template(s): ${missingTemplates.join(', ')}. Reconnect or restore the template before exporting.`,
    );
  }
  if (missingAssets.length > 0) {
    throw new Error(
      `Export cannot include missing mockup template asset(s): ${missingAssets.join(', ')}. Reconnect or restore the plate or mask before exporting.`,
    );
  }

  const cache = getImageCache();
  const failures: string[] = [];
  await Promise.all(
    [...assets].map(async ([assetId, dataUrl]) => {
      throwIfMockupExportAborted(options.signal);
      try {
        await cache.load(dataUrl);
      } catch (error) {
        failures.push(`${assetId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  throwIfMockupExportAborted(options.signal);
  if (failures.length > 0) {
    failures.sort();
    throw new Error(
      `Export cannot decode mockup template asset(s): ${failures.join('; ')}. Check the embedded resource or replace the template asset.`,
    );
  }
}

/** Return all document node ids reachable from the supplied render roots. */
function subtreeNodeIds(doc: Document, rootIds: readonly NodeId[]): NodeId[] {
  return [...walkNodes(doc, [...rootIds])].map(([id]) => id);
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
  // `flattenedIds` is the authoritative parallel list for `items`; roots may
  // contain only a parent/group and therefore miss nested mockup frames.
  // Keep a defensive fallback for callers that provide a partial test list.
  const decorationNodeIds =
    flattenedIds.length === items.length ? (flattenedIds as NodeId[]) : [...rootIds];

  if (decorationNodeIds.some((id) => isMockupFrame(doc.nodes[id]))) {
    const result = decorateMockupIr({
      doc,
      nodeIds: decorationNodeIds,
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
  decoratePerspectiveImages({ doc, nodeIds: decorationNodeIds, items, qualityScale });
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
        : surface.reason === 'invalid-geometry'
          ? 'its surface geometry could not be rendered within the supported bounds'
          : 'no source is assigned';
  return `Mockup surface “${surface.surfaceName}” was exported with a placeholder: ${reason}. Reconnect or replace the source and export again.`;
}
