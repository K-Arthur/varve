/**
 * Bounded source pixels for hybrid illustration tools.
 *
 * This deliberately renders the active scene through Varve's structural
 * compositor. It never reads the visible canvas, so selection handles,
 * checkerboards, proof views and other UI overlays cannot become artwork.
 * There is no persistent cache: each request pins one immutable document and
 * releases its temporary surface as soon as the pixel snapshot is made.
 */

import type { RenderItem } from '@varve/engine';
import {
  createEngine,
  createRasterSurface,
  primitiveBounds,
  totalEffectExpansion,
} from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { buildParentIndexMap, effectPadding, TILE_SIZE } from '@varve/scene';
import { applyAffine } from '@varve/shared';
import { settleEngineImageResources } from '../export/resourceReadiness';
import { replayStructuredScene } from '../render/replayScene';
import { collectMaskSourceDependencies, flattenSceneToEngine } from '../render/sceneToEngine';
import { nodeWorldTransform } from '../scene/world';

const MAX_SAMPLE_DIMENSION = 16_384;
const MAX_SAMPLE_PIXELS = 16_777_216;

export interface ArtworkSampleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ArtworkSampleResult =
  | {
      status: 'ready';
      document: Document;
      rootIds: readonly NodeId[];
      bounds: ArtworkSampleBounds;
      imageData: ImageData;
    }
  | { status: 'cancelled' | 'failed'; reason: string };

/** Convert finite artwork extents to an allocation that fits selection limits. */
export function fitArtworkSampleBounds(bounds: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): ArtworkSampleBounds | null {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return null;
  const x = Math.floor(bounds.left);
  const y = Math.floor(bounds.top);
  const right = Math.ceil(bounds.right);
  const bottom = Math.ceil(bounds.bottom);
  const width = right - x;
  const height = bottom - y;
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_SAMPLE_DIMENSION ||
    height > MAX_SAMPLE_DIMENSION ||
    width > Math.floor(MAX_SAMPLE_PIXELS / height)
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** Treat transparent paper as white while preserving antialiased line edges. */
export function matteTransparentArtworkWhite(imageData: ImageData): ImageData {
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]! / 255;
    if (alpha < 1) {
      const paper = 255 * (1 - alpha);
      pixels[index] = pixels[index]! * alpha + paper;
      pixels[index + 1] = pixels[index + 1]! * alpha + paper;
      pixels[index + 2] = pixels[index + 2]! * alpha + paper;
      pixels[index + 3] = 255;
    }
  }
  return imageData;
}

/** Hide unapproved reference nodes in a disposable sampling snapshot. */
export function documentForArtworkSampling(document: Document): Document {
  let nodes: Document['nodes'] | undefined;
  for (const [id, node] of Object.entries(document.nodes)) {
    if (
      node.kind !== 'shape' ||
      !node.conceptArtReference ||
      node.conceptArtReference.includeInSampling === true ||
      node.visible === false
    ) {
      continue;
    }
    nodes ??= { ...document.nodes };
    nodes[id] = { ...node, visible: false };
  }
  return nodes ? { ...document, nodes } : document;
}

function nodeEffectPadding(node: SceneNode | undefined): [number, number, number, number] {
  const result: [number, number, number, number] = [0, 0, 0, 0];
  const effects = node && 'effects' in node && Array.isArray(node.effects) ? node.effects : [];
  for (const effect of effects) {
    if (effect.visible === false) continue;
    const padding = effectPadding(effect);
    result[0] += padding.left;
    result[1] += padding.top;
    result[2] += padding.right;
    result[3] += padding.bottom;
  }
  return result;
}

function ancestorEffectExpansion(
  nodeId: NodeId,
  document: Document,
  parentIndex: Map<NodeId, NodeId>,
): [number, number] {
  let x = 0;
  let y = 0;
  let ancestorId = parentIndex.get(nodeId);
  const visited = new Set<NodeId>();
  while (ancestorId && !visited.has(ancestorId)) {
    visited.add(ancestorId);
    const ancestor = document.nodes[ancestorId];
    const padding = nodeEffectPadding(ancestor);
    const radius = Math.max(...padding);
    if (radius > 0) {
      const transform = nodeWorldTransform(document, ancestorId, parentIndex);
      x += radius * (Math.abs(transform[0]) + Math.abs(transform[2]));
      y += radius * (Math.abs(transform[1]) + Math.abs(transform[3]));
    }
    ancestorId = parentIndex.get(ancestorId);
  }
  return [x, y];
}

function visibleBounds(
  flattenedIds: readonly NodeId[],
  document: Document,
  items: readonly RenderItem[],
):
  | { status: 'ready'; bounds: ArtworkSampleBounds }
  | { status: 'empty' }
  | { status: 'oversized' } {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const parentIndex = buildParentIndexMap(document);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    let local = primitiveBounds(item.primitive);
    const node = document.nodes[flattenedIds[index]!];
    if (node?.kind === 'rasterLayer') {
      // Raster nodes advertise their full canvas size even when only a few
      // sparse tiles contain pixels. Bound the sample to those actual tiles.
      const tileEntries = node.tiles instanceof Map ? [...node.tiles.keys()] : [];
      if (tileEntries.length === 0) continue;
      let minCol = Number.POSITIVE_INFINITY;
      let minRow = Number.POSITIVE_INFINITY;
      let maxCol = Number.NEGATIVE_INFINITY;
      let maxRow = Number.NEGATIVE_INFINITY;
      for (const key of tileEntries) {
        const [col, row] = key.split(':').map(Number);
        if (![col, row].every(Number.isInteger)) continue;
        minCol = Math.min(minCol, col!);
        minRow = Math.min(minRow, row!);
        maxCol = Math.max(maxCol, col!);
        maxRow = Math.max(maxRow, row!);
      }
      if (![minCol, minRow, maxCol, maxRow].every(Number.isFinite)) continue;
      local = {
        x: minCol * TILE_SIZE,
        y: minRow * TILE_SIZE,
        w: Math.min(node.width, (maxCol + 1) * TILE_SIZE) - minCol * TILE_SIZE,
        h: Math.min(node.height, (maxRow + 1) * TILE_SIZE) - minRow * TILE_SIZE,
      };
    }
    if (
      ![local.x, local.y, local.w, local.h].every(Number.isFinite) ||
      local.w < 0 ||
      local.h < 0
    ) {
      continue;
    }
    const effectPad = nodeEffectPadding(node);
    const filterPad = item.filters ? totalEffectExpansion(item.filters) : [0, 0, 0, 0];
    const strokePad = Math.max(0, ...(item.strokes ?? []).map((stroke) => stroke.weight / 2));
    const [ancestorPadX, ancestorPadY] = ancestorEffectExpansion(
      flattenedIds[index]!,
      document,
      parentIndex,
    );
    const antialiasPad = node?.kind === 'rasterLayer' ? 0 : 1;
    const pad = effectPad.map(
      (value, side) => value + (filterPad[side] ?? 0) + strokePad + antialiasPad,
    ) as [number, number, number, number];
    const x = local.x - pad[0];
    const y = local.y - pad[1];
    const w = local.w + pad[0] + pad[2];
    const h = local.h + pad[1] + pad[3];
    const corners = [
      applyAffine(item.transform, [x, y]),
      applyAffine(item.transform, [x + w, y]),
      applyAffine(item.transform, [x + w, y + h]),
      applyAffine(item.transform, [x, y + h]),
    ];
    const xs = corners.map(([worldX]) => worldX);
    const ys = corners.map(([, worldY]) => worldY);
    left = Math.min(left, Math.min(...xs) - ancestorPadX);
    top = Math.min(top, Math.min(...ys) - ancestorPadY);
    right = Math.max(right, Math.max(...xs) + ancestorPadX);
    bottom = Math.max(bottom, Math.max(...ys) + ancestorPadY);
  }
  if (![left, top, right, bottom].every(Number.isFinite)) return { status: 'empty' };
  const bounds = fitArtworkSampleBounds({ left, top, right, bottom });
  return bounds ? { status: 'ready', bounds } : { status: 'oversized' };
}

/** Render one immutable active-surface revision and return a white-matted sample. */
export async function sampleVisibleArtwork(request: {
  document: Document;
  rootIds: readonly NodeId[];
  signal?: AbortSignal;
}): Promise<ArtworkSampleResult> {
  const { document, rootIds, signal } = request;
  if (signal?.aborted) return { status: 'cancelled', reason: 'Artwork sampling was cancelled' };
  if (rootIds.length === 0)
    return { status: 'failed', reason: 'No visible artwork is available to sample' };

  let surface: ReturnType<typeof createRasterSurface> | null = null;
  try {
    const samplingDocument = documentForArtworkSampling(document);
    const maskSourceIds = collectMaskSourceDependencies(samplingDocument, rootIds);
    const flattened = flattenSceneToEngine(samplingDocument, [...rootIds, ...maskSourceIds]);
    if (flattened.nodes.length === 0) {
      return { status: 'failed', reason: 'No visible artwork is available to sample' };
    }
    const resources = await settleEngineImageResources(flattened.nodes, {
      signal,
      timeoutMs: 4_000,
    });
    if (resources.status === 'cancelled' || signal?.aborted) {
      return { status: 'cancelled', reason: 'Artwork sampling was cancelled' };
    }
    if (resources.status === 'timeout') {
      return {
        status: 'failed',
        reason: 'Wait for visible images to finish loading, then sample again',
      };
    }
    if (resources.status === 'failed') {
      return {
        status: 'failed',
        reason: 'A visible image could not be read for Magic Wand sampling',
      };
    }

    const engine = await createEngine('stub');
    if (signal?.aborted) return { status: 'cancelled', reason: 'Artwork sampling was cancelled' };
    const items = await engine.buildIr({ nodes: flattened.nodes });
    if (signal?.aborted) return { status: 'cancelled', reason: 'Artwork sampling was cancelled' };
    const extent = visibleBounds(flattened.ids, samplingDocument, items);
    if (extent.status === 'empty') {
      return { status: 'failed', reason: 'No visible pixels are available to sample' };
    }
    if (extent.status === 'oversized') {
      return {
        status: 'failed',
        reason: 'Visible artwork exceeds the 16-megapixel Magic Wand sample limit',
      };
    }
    const bounds = extent.bounds;

    surface = createRasterSurface(bounds.width, bounds.height, { willReadFrequently: true });
    const context = surface.context;
    context.save();
    context.translate(-bounds.x, -bounds.y);
    replayStructuredScene(context, {
      document: samplingDocument,
      rootIds,
      flattenedIds: flattened.ids,
      items,
      quality: 'export',
    });
    context.restore();
    const imageData = matteTransparentArtworkWhite(
      context.getImageData(0, 0, bounds.width, bounds.height),
    );
    return { status: 'ready', document, rootIds: [...rootIds], bounds, imageData };
  } catch (error) {
    return {
      status: signal?.aborted ? 'cancelled' : 'failed',
      reason:
        error instanceof Error && error.message.includes('taint')
          ? 'A visible image is protected from pixel sampling by the browser'
          : 'Visible artwork could not be sampled at this size',
    };
  } finally {
    if (surface) {
      try {
        surface.canvas.width = 0;
        surface.canvas.height = 0;
      } catch {
        // Releasing an already-disposed offscreen surface is best-effort.
      }
    }
  }
}
