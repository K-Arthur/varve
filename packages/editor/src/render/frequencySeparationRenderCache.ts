/**
 * Render-time decode of frequency-separation groups with bounded caching.
 *
 * The decode is a full-layer pass; caching by band revisions keeps it off the
 * per-frame path while band edits (which bump tile versions) invalidate it
 * exactly. Pixel-budgeted so several large separations cannot exhaust memory.
 */

import { liquifyFieldRevision } from '@varve/engine';
import {
  type Document,
  decodeFrequencySeparationTiles,
  type RasterTile,
  resolveFrequencySeparation,
} from '@varve/scene';
import { rasterTileMapRevision, renderableLiquifyField } from './liquifyRenderCache';

interface DecodedEntry {
  key: string;
  pixels: number;
  tiles: Map<string, RasterTile>;
}

const MAX_CACHE_PIXELS = 24 * 1024 * 1024;
const cache = new Map<string, DecodedEntry>();
let cachedPixels = 0;

/**
 * Decoded composite tiles for a separation group, or null when the marker is
 * inert (missing/unlinked bands) so the caller can fall back to normal group
 * rendering.
 */
export function decodedSeparationTilesForRender(
  doc: Document,
  groupId: string,
): Map<string, RasterTile> | null {
  const resolved = resolveFrequencySeparation(doc, groupId);
  if (!resolved) return null;
  const low = doc.nodes[resolved.state.lowNodeId];
  const high = doc.nodes[resolved.state.highNodeId];
  if (low?.kind !== 'rasterLayer' || !high || high.kind !== 'rasterLayer') return null;

  const key = [
    resolved.state.method,
    resolved.state.radius,
    low.width,
    low.height,
    rasterTileMapRevision(low.tiles),
    rasterTileMapRevision(high.tiles),
    liquifyFieldRevision(renderableLiquifyField(low)),
    liquifyFieldRevision(renderableLiquifyField(high)),
  ].join('|');

  const existing = cache.get(groupId);
  if (existing && existing.key === key) {
    cache.delete(groupId);
    cache.set(groupId, existing);
    return existing.tiles;
  }

  const decoded = decodeFrequencySeparationTiles(doc, groupId);
  if (!decoded) return null;
  const version = (hashString(`${groupId}|${key}`) % 1_000_000) + 1;
  for (const tile of decoded.tiles.values()) tile.version = version;

  evictExcess();
  const pixels = decoded.width * decoded.height;
  cache.set(groupId, { key, pixels, tiles: decoded.tiles });
  cachedPixels += pixels;
  return decoded.tiles;
}

export function releaseFrequencySeparationRenderCache(groupId?: string): void {
  if (groupId === undefined) {
    cache.clear();
    cachedPixels = 0;
    return;
  }
  const entry = cache.get(groupId);
  if (entry) {
    cachedPixels -= entry.pixels;
    cache.delete(groupId);
  }
}

function evictExcess(): void {
  while (cachedPixels > MAX_CACHE_PIXELS && cache.size > 0) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const entry = cache.get(oldestKey);
    if (entry) cachedPixels -= entry.pixels;
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
