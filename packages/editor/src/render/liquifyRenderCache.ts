/**
 * Render-time liquify warping with bounded caching.
 *
 * Warping a full layer is only redone when its authored deformation or its
 * source tiles change. The cache is keyed by node id + a revision that folds
 * in tile versions and the field revision, and is byte-budgeted so a large
 * document cannot accumulate warped copies indefinitely.
 */

import {
  imageDataToRasterTiles,
  isIdentityLiquifyField,
  type LiquifyField,
  liquifyFieldRevision,
  rasterTilesToImageData,
  validateLiquifyField,
  warpImageDataByField,
} from '@varve/engine';
import { type RasterLayerNode, type RasterTile, TILE_SIZE } from '@varve/scene';

export interface RasterTilesLike {
  width: number;
  height: number;
  tiles: Map<string, RasterTile>;
}

interface CacheEntry {
  key: string;
  pixels: number;
  tiles: Map<string, RasterTile>;
}

const MAX_CACHE_PIXELS = 16 * 1024 * 1024;
const cache = new Map<string, CacheEntry>();
let cachedPixels = 0;

export interface LiquifyRenderCacheStats {
  entries: number;
  pixels: number;
  maxPixels: number;
}

/** Read-only diagnostics used by performance evidence and regression tests. */
export function getLiquifyRenderCacheStats(): LiquifyRenderCacheStats {
  return { entries: cache.size, pixels: cachedPixels, maxPixels: MAX_CACHE_PIXELS };
}

/** FNV-1a over tile keys and versions: cheap, order-independent enough. */
export function rasterTileMapRevision(tiles: ReadonlyMap<string, RasterTile>): string {
  let hash = 2166136261;
  let count = 0;
  for (const [key, tile] of tiles) {
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= tile.version;
    hash = Math.imul(hash, 16777619);
    count++;
  }
  return `${count}:${(hash >>> 0).toString(36)}`;
}

export function renderableLiquifyField(
  node: Pick<RasterLayerNode, 'liquify'>,
): LiquifyField | null {
  const field = validateLiquifyField(node.liquify);
  if (!field || isIdentityLiquifyField(field)) return null;
  return field;
}

/** Tiles to render for a raster node, warped by its liquify field if any. */
export function warpedTilesForRender(node: RasterLayerNode): Map<string, RasterTile> {
  const field = renderableLiquifyField(node);
  if (!field) return node.tiles;
  if (node.width <= 0 || node.height <= 0 || node.tiles.size === 0) return node.tiles;

  const key = `${node.id}|${node.width}x${node.height}|${rasterTileMapRevision(node.tiles)}|${liquifyFieldRevision(field)}`;
  const existing = cache.get(node.id);
  if (existing && existing.key === key) {
    cache.delete(node.id);
    cache.set(node.id, existing);
    return existing.tiles;
  }

  const source = rasterTilesToImageData(node.tiles, node.width, node.height, TILE_SIZE);
  const warped = warpImageDataByField(source, field, {
    outputWidth: node.width,
    outputHeight: node.height,
  });
  const tiles = imageDataToRasterTiles(warped, TILE_SIZE);
  // A version that changes with the cache key keeps the engine's per-layer
  // surface cache in sync (it re-uploads exactly when the warp changes).
  const version = (hashString(key) % 1_000_000) + 1;
  for (const tile of tiles.values()) tile.version = version;

  const pixels = node.width * node.height;
  const previous = cache.get(node.id);
  if (previous) {
    cachedPixels -= previous.pixels;
    cache.delete(node.id);
  }
  // Do not retain a one-off entry that is larger than the entire cache budget.
  // Returning the freshly computed result is still correct; retaining it would
  // make the budget unenforceable and pin a large raster until process exit.
  if (pixels > MAX_CACHE_PIXELS) return tiles;
  cache.set(node.id, { key, pixels, tiles });
  cachedPixels += pixels;
  evictExcess();
  return tiles;
}

/** Drop cached warps for nodes that no longer exist or are unloaded. */
export function releaseLiquifyRenderCache(nodeId?: string): void {
  if (nodeId === undefined) {
    cache.clear();
    cachedPixels = 0;
    return;
  }
  const entry = cache.get(nodeId);
  if (entry) {
    cachedPixels = Math.max(0, cachedPixels - entry.pixels);
    cache.delete(nodeId);
  }
}

function evictExcess(): void {
  while (cachedPixels > MAX_CACHE_PIXELS && cache.size > 0) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const entry = cache.get(oldestKey);
    if (entry) cachedPixels = Math.max(0, cachedPixels - entry.pixels);
    cache.delete(oldestKey);
  }
}

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
