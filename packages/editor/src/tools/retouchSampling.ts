/**
 * Retouch sampling sources — "which pixels does clone/heal/spot/patch sample?"
 *
 * One place answers that question for the retouch tool family, scoped to the
 * active page/subtree rather than the whole document. The source is a frozen,
 * read-only tile composite in the target layer's local pixel space; deposits
 * always land on the target layer, so sampling several layers never bakes them
 * into one.
 *
 * Sampling scopes follow the established raster-editor contract:
 *
 * - `current`    — the target layer alone.
 * - `below`      — the target layer plus every contributing layer below it in
 *                  scene paint order ("Current and Below").
 * - `allVisible` — every visible contributing layer on the active page.
 *
 * What is reproduced: page/subtree scope, paint order, ancestor visibility,
 * per-layer visibility and opacity, layer transforms (mapped into the target's
 * local space), and separable/non-separable blend modes through the shared
 * engine `blend()`. What is deliberately not reproduced: layer masks,
 * clipping, group opacity, and live effects; those require a renderer-backed
 * readback and are documented as limitations rather than approximated by
 * combining unrelated tile coordinates.
 */
import { blend } from '@varve/engine';
import type { RasterLayerNode, RasterTile, SceneNode } from '@varve/scene';
import { makeTileKey, sampleTilesBilinear, TILE_SIZE } from '@varve/scene';
import { type Affine, applyAffine, multiplyAffine, tryInvertAffine } from '@varve/shared';
import type { ToolContext } from './types';

export type SamplingScope = 'current' | 'below' | 'allVisible';

export interface RasterSamplingLayer {
  id: string;
  tiles: Map<string, RasterTile>;
  opacity?: number;
  visible?: boolean;
  /** Layer paint blend mode. Applied when compositing the sample, not deposits. */
  blendMode?: string;
  /** Layer-local to world transform, when the caller can resolve one. */
  transform?: Affine;
}

export interface RetouchSampleResult {
  /** Composite in the target layer's local pixel space (read-only snapshot). */
  tiles: Map<string, RasterTile>;
  /** True when the transformed-layer budget stopped part of the sample. */
  truncated: boolean;
  /** Contributing layers actually composited. */
  contributors: number;
}

const IDENTITY_AFFINE: Affine = [1, 0, 0, 1, 0, 0];

/**
 * Bounded work for the transformed path. A 16 MPixel budget is roughly 64 MB of
 * RGBA accumulation before masks/previews; exceeding it reports `truncated`
 * instead of silently allocating without limit.
 */
const MAX_TRANSFORMED_SAMPLE_PIXELS = 16 * 1024 * 1024;

/**
 * Return raster sources in the same bottom-to-top order exposed by the active
 * scene scope. Object insertion order is not paint order: layer reordering
 * edits the parent child arrays without rebuilding `document.nodes`.
 *
 * Hidden ancestors are excluded so merged sampling cannot pull pixels from a
 * hidden group or from another page's subtree.
 */
export function rasterSamplingLayersInPaintOrder(
  ctx: Pick<ToolContext, 'document' | 'rootNodes'> & {
    getWorldTransform?: ToolContext['getWorldTransform'];
  },
): RasterSamplingLayer[] {
  const layers: RasterSamplingLayer[] = [];
  const visited = new Set<string>();

  const visit = (nodes: readonly SceneNode[], inheritedVisible: boolean): void => {
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);

      const visible = inheritedVisible && (node as { visible?: boolean }).visible !== false;
      if (!visible) continue;

      if ((node as { kind?: string }).kind === 'rasterLayer') {
        const raster = node as unknown as RasterLayerNode;
        layers.push({
          id: raster.id,
          tiles: raster.tiles,
          opacity: raster.opacity,
          visible: raster.visible,
          blendMode: raster.blendMode,
          transform: ctx.getWorldTransform?.(raster.id),
        });
      }

      const childIds = 'children' in node && Array.isArray(node.children) ? node.children : [];
      if (childIds.length === 0) continue;
      visit(
        childIds
          .map((childId) => ctx.document.nodes[childId])
          .filter((child): child is SceneNode => Boolean(child)),
        visible,
      );
    }
  };

  visit(ctx.rootNodes(), true);
  return layers;
}

/**
 * Narrow the paint-order list to the layers a scope may sample.
 *
 * `below` includes the target itself because "Current and Below" means the
 * active layer plus everything under it; `current` is deliberately the target
 * alone, not "the first raster in the subtree".
 */
export function layersForSamplingScope(
  layers: readonly RasterSamplingLayer[],
  targetId: string,
  scope: SamplingScope,
): RasterSamplingLayer[] {
  if (scope === 'allVisible') return [...layers];
  const index = layers.findIndex((layer) => layer.id === targetId);
  if (index < 0) return [];
  if (scope === 'current') return [layers[index]!];
  return layers.slice(0, index + 1);
}

function isIdentityAffine(m: Affine, epsilon = 1e-6): boolean {
  return (
    Math.abs(m[0] - 1) <= epsilon &&
    Math.abs(m[1]) <= epsilon &&
    Math.abs(m[2]) <= epsilon &&
    Math.abs(m[3] - 1) <= epsilon &&
    Math.abs(m[4]) <= epsilon &&
    Math.abs(m[5]) <= epsilon
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readNormalized(
  destination: Uint8ClampedArray,
  index: number,
): [number, number, number, number] {
  return [
    destination[index]! / 255,
    destination[index + 1]! / 255,
    destination[index + 2]! / 255,
    destination[index + 3]! / 255,
  ];
}

interface SampleRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Composite one straight-alpha byte sample into `destination` in place.
 * Normal mode uses the shared source-over equation; every other mode
 * delegates to the engine's blend implementation so the sample matches the
 * layer's declared blend instead of pretending it is normal.
 */
function mergeSampleRgba(
  destination: Uint8ClampedArray,
  index: number,
  source: SampleRgba,
  opacity: number,
  mode: string,
): void {
  if (mode === 'normal') {
    const srcA = (source.a / 255) * opacity;
    if (srcA <= 0) return;
    const destA = destination[index + 3]! / 255;
    const outA = srcA + destA * (1 - srcA);
    if (outA <= 0) {
      destination[index] = 0;
      destination[index + 1] = 0;
      destination[index + 2] = 0;
      destination[index + 3] = 0;
      return;
    }
    const sourceChannels = [source.r, source.g, source.b];
    for (let channel = 0; channel < 3; channel++) {
      const s = (sourceChannels[channel]! / 255) * srcA;
      const d = (destination[index + channel]! / 255) * destA * (1 - srcA);
      destination[index + channel] = Math.round(((s + d) / outA) * 255);
    }
    destination[index + 3] = Math.round(outA * 255);
    return;
  }

  const [r, g, b, a] = blend(
    readNormalized(destination, index),
    [source.r / 255, source.g / 255, source.b / 255, source.a / 255],
    mode,
    opacity,
  );
  destination[index] = Math.round(r * 255);
  destination[index + 1] = Math.round(g * 255);
  destination[index + 2] = Math.round(b * 255);
  destination[index + 3] = Math.round(a * 255);
}

function mergeSampleBuffer(
  destination: Uint8ClampedArray,
  source: Uint8ClampedArray,
  opacity: number,
  mode: string,
): void {
  for (let index = 0; index < destination.length; index += 4) {
    mergeSampleRgba(
      destination,
      index,
      {
        r: source[index]!,
        g: source[index + 1]!,
        b: source[index + 2]!,
        a: source[index + 3]!,
      },
      opacity,
      mode,
    );
  }
}

function firstContributorTile(
  pixels: Uint8ClampedArray,
  opacity: number,
  version: number,
): RasterTile {
  const copy = new Uint8ClampedArray(pixels);
  if (opacity < 1) {
    for (let index = 3; index < copy.length; index += 4) {
      copy[index] = copy[index]! * opacity;
    }
  }
  return { pixels: copy, version };
}

/** Fast path: layers already share the target's pixel space and tile grid. */
function mergeAlignedLayer(
  out: Map<string, RasterTile>,
  layer: RasterSamplingLayer,
  opacity: number,
  mode: string,
): void {
  for (const [key, tile] of layer.tiles) {
    const existing = out.get(key);
    if (!existing) {
      out.set(key, firstContributorTile(tile.pixels, opacity, tile.version));
      continue;
    }
    mergeSampleBuffer(existing.pixels, tile.pixels, opacity, mode);
  }
}

/**
 * General path: map a layer's tiles into the target's local pixel space.
 *
 * Each source tile's bounds are transformed into target space, clipped to the
 * target's extent, and inverse-sampled bilinearly. Only target tiles that
 * receive at least one contribution are allocated, so sparse layers stay
 * sparse. `budget` bounds worst-case work for extreme scale factors.
 */
function mergeTransformedLayer(
  out: Map<string, RasterTile>,
  layer: RasterSamplingLayer,
  relative: Affine,
  opacity: number,
  mode: string,
  targetWidth: number,
  targetHeight: number,
  budget: { remaining: number; truncated: boolean },
): void {
  const inverse = tryInvertAffine(relative);
  if (!inverse) {
    // A singular transform cannot place the layer's pixels anywhere
    // meaningful; report it as omitted rather than inventing a mapping.
    budget.truncated = true;
    return;
  }

  for (const [key] of layer.tiles) {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      return;
    }
    const [col, row] = key.split(':').map(Number);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    const tileX = col! * TILE_SIZE;
    const tileY = row! * TILE_SIZE;

    const corners = [
      applyAffine(relative, [tileX, tileY]),
      applyAffine(relative, [tileX + TILE_SIZE, tileY]),
      applyAffine(relative, [tileX + TILE_SIZE, tileY + TILE_SIZE]),
      applyAffine(relative, [tileX, tileY + TILE_SIZE]),
    ];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner[1]))));
    const maxX = Math.min(targetWidth, Math.ceil(Math.max(...corners.map((corner) => corner[0]))));
    const maxY = Math.min(targetHeight, Math.ceil(Math.max(...corners.map((corner) => corner[1]))));
    if (maxX <= minX || maxY <= minY) continue;

    for (let targetY = minY; targetY < maxY; targetY++) {
      if (budget.remaining <= 0) {
        budget.truncated = true;
        return;
      }
      for (let targetX = minX; targetX < maxX; targetX++) {
        if (budget.remaining <= 0) {
          budget.truncated = true;
          return;
        }
        budget.remaining -= 1;
        const [layerX, layerY] = applyAffine(inverse, [targetX, targetY]);
        const sample = sampleTilesBilinear(layer.tiles, layerX, layerY);
        if (!sample || sample.a === 0) continue;
        const targetCol = Math.floor(targetX / TILE_SIZE);
        const targetRow = Math.floor(targetY / TILE_SIZE);
        const targetKey = makeTileKey(targetCol, targetRow);
        let targetTile = out.get(targetKey);
        if (!targetTile) {
          targetTile = {
            pixels: new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4),
            version: 1,
          };
          out.set(targetKey, targetTile);
        }
        const ox = targetX - targetCol * TILE_SIZE;
        const oy = targetY - targetRow * TILE_SIZE;
        const index = (oy * TILE_SIZE + ox) * 4;
        mergeSampleRgba(targetTile.pixels, index, sample, opacity, mode);
      }
    }
  }
}

/**
 * Compose the sampled source in the target's local pixel space, bottom-up.
 *
 * The result is a fresh read-only snapshot: tile objects from contributing
 * layers are never aliased into the composite, so a stroke cannot write back
 * into the layers it samples.
 */
export function composeRetouchSample(request: {
  targetTransform: Affine;
  targetWidth: number;
  targetHeight: number;
  layers: readonly RasterSamplingLayer[];
}): RetouchSampleResult {
  const out = new Map<string, RasterTile>();
  const budget = { remaining: MAX_TRANSFORMED_SAMPLE_PIXELS, truncated: false };
  let contributors = 0;

  for (const layer of request.layers) {
    if (layer.visible === false) continue;
    const opacity = clamp01(layer.opacity ?? 1);
    if (opacity <= 0 || layer.tiles.size === 0) continue;

    const mode = layer.blendMode ?? 'normal';
    const relative = layer.transform
      ? multiplyAffine(tryInvertAffine(request.targetTransform) ?? IDENTITY_AFFINE, layer.transform)
      : IDENTITY_AFFINE;

    if (isIdentityAffine(relative)) {
      mergeAlignedLayer(out, layer, opacity, mode);
    } else {
      mergeTransformedLayer(
        out,
        layer,
        relative,
        opacity,
        mode,
        request.targetWidth,
        request.targetHeight,
        budget,
      );
    }
    contributors += 1;
  }

  return { tiles: out, truncated: budget.truncated, contributors };
}

/**
 * Tool-facing entry point: resolve the active scene scope, narrow it to the
 * requested sampling scope, and compose the source in the target layer's space.
 */
export function buildRetouchSampleSource(
  ctx: Pick<ToolContext, 'document' | 'rootNodes'> & {
    getWorldTransform?: ToolContext['getWorldTransform'];
  },
  target: RasterLayerNode,
  scope: SamplingScope,
): RetouchSampleResult {
  const layers = rasterSamplingLayersInPaintOrder(ctx);
  const scoped = layersForSamplingScope(layers, target.id, scope);
  const targetTransform =
    ctx.getWorldTransform?.(target.id) ??
    (target.transform as Affine | undefined) ??
    IDENTITY_AFFINE;
  return composeRetouchSample({
    targetTransform,
    targetWidth: target.width,
    targetHeight: target.height,
    layers: scoped,
  });
}
