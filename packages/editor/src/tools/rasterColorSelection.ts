import {
  type AreaSelection,
  areaSelectionFromColorRange,
  transformAreaSelection,
} from '@varve/engine';
import { makeTileKey, type RasterLayerNode, TILE_SIZE } from '@varve/scene';

/**
 * Interactive raster colour selection is deliberately smaller than the
 * general export budget. A Magic Wand gesture must not allocate a full-size
 * RGBA copy of an unbounded paint layer while the pointer is still active.
 */
export const MAX_RASTER_WAND_PIXELS = 4_194_304;
const MAX_RASTER_WAND_DIMENSION = 4096;

export interface RasterColorSelectionOptions {
  /** Maximum OKLab distance for a full match. */
  tolerance: number;
  /** Additional OKLab falloff beyond tolerance. */
  feather: number;
  mode: 'global' | 'contiguous';
}

interface WorkingRasterSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function workingSize(width: number, height: number): { width: number; height: number } {
  let nextWidth = Math.min(MAX_RASTER_WAND_DIMENSION, Math.max(1, Math.floor(width)));
  let nextHeight = Math.min(MAX_RASTER_WAND_DIMENSION, Math.max(1, Math.floor(height)));
  if (nextWidth * nextHeight > MAX_RASTER_WAND_PIXELS) {
    const scale = Math.sqrt(MAX_RASTER_WAND_PIXELS / (nextWidth * nextHeight));
    nextWidth = Math.max(1, Math.floor(nextWidth * scale));
    nextHeight = Math.max(1, Math.floor(nextHeight * scale));
  }
  return { width: nextWidth, height: nextHeight };
}

function copyRasterPixel(
  node: RasterLayerNode,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  at: number,
): void {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  const tile = node.tiles.get(makeTileKey(col, row));
  if (!tile || tile.pixels.length !== TILE_SIZE * TILE_SIZE * 4) return;
  const localX = x - col * TILE_SIZE;
  const localY = y - row * TILE_SIZE;
  const sourceAt = (localY * TILE_SIZE + localX) * 4;
  target[at] = tile.pixels[sourceAt] ?? 0;
  target[at + 1] = tile.pixels[sourceAt + 1] ?? 0;
  target[at + 2] = tile.pixels[sourceAt + 2] ?? 0;
  target[at + 3] = tile.pixels[sourceAt + 3] ?? 0;
}

function readWorkingSource(node: RasterLayerNode): WorkingRasterSource | null {
  if (
    !Number.isSafeInteger(node.width) ||
    !Number.isSafeInteger(node.height) ||
    node.width <= 0 ||
    node.height <= 0
  ) {
    return null;
  }
  const size = workingSize(node.width, node.height);
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  const scaleX = node.width / size.width;
  const scaleY = node.height / size.height;
  for (let y = 0; y < size.height; y += 1) {
    const sourceY = Math.min(node.height - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = 0; x < size.width; x += 1) {
      const sourceX = Math.min(node.width - 1, Math.floor((x + 0.5) * scaleX));
      copyRasterPixel(node, sourceX, sourceY, data, (y * size.width + x) * 4);
    }
  }
  return { data, width: size.width, height: size.height };
}

/**
 * Derive a document-independent colour selection from one raster layer.
 *
 * The returned selection is in the raster layer's local pixel space. The
 * caller owns the full scene transform, which keeps this helper useful for
 * transformed and nested paint layers without duplicating scene traversal.
 */
export function rasterColorSelectionAt(
  node: RasterLayerNode,
  localPoint: { x: number; y: number },
  options: RasterColorSelectionOptions,
): AreaSelection | null {
  if (
    !Number.isFinite(localPoint.x) ||
    !Number.isFinite(localPoint.y) ||
    localPoint.x < 0 ||
    localPoint.y < 0 ||
    localPoint.x >= node.width ||
    localPoint.y >= node.height
  ) {
    return null;
  }
  const source = readWorkingSource(node);
  if (!source) return null;
  const sourceX = Math.min(
    source.width - 1,
    Math.floor((localPoint.x / node.width) * source.width + 0.5),
  );
  const sourceY = Math.min(
    source.height - 1,
    Math.floor((localPoint.y / node.height) * source.height + 0.5),
  );
  const sourceAt = (sourceY * source.width + sourceX) * 4;
  const alpha = source.data[sourceAt + 3] ?? 0;
  if (alpha === 0) return null;

  const selection = areaSelectionFromColorRange(
    source,
    {
      r: source.data[sourceAt] ?? 0,
      g: source.data[sourceAt + 1] ?? 0,
      b: source.data[sourceAt + 2] ?? 0,
    },
    {
      tolerance: options.tolerance,
      feather: options.feather,
      mode: options.mode,
      seed: { x: sourceX, y: sourceY },
    },
  );
  if (!selection) return null;

  return transformAreaSelection(selection, [
    node.width / source.width,
    0,
    0,
    node.height / source.height,
    0,
    0,
  ]);
}
