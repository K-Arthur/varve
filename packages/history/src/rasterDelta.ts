/**
 * Exact raster tile deltas for persistent history.
 *
 * The scene model deliberately owns live `Uint8ClampedArray` tiles, while the
 * history package owns persistence. A history operation therefore stores only
 * stable content hashes and versions; the pixels live in `RasterTileStore`.
 * This keeps brush replay independent from the current brush implementation.
 */

import type { Document, RasterLayerNode, RasterTile, SceneNode } from '@varve/scene';
import type { RasterTileEntry, RasterTileStore } from './rasterTileStore';
import { hashTilePixels } from './rasterTileStore';

export const RASTER_DELTA_OPERATION = 'document.raster-delta';

export interface RasterTileDelta {
  /** Local `"{col}:{row}"` key within `nodeId`. */
  tileKey: string;
  /** Null represents an absent tile, not a transparent allocated tile. */
  beforeHash: string | null;
  afterHash: string | null;
  /** Version is cache-invalidation metadata, retained exactly for snapshots. */
  beforeVersion: number | null;
  afterVersion: number | null;
}

export interface RasterNodeDelta {
  nodeId: string;
  tiles: RasterTileDelta[];
}

export interface RasterDeltaPayload {
  transactionId: string;
  beforeHash: string;
  afterHash: string;
  nodes: RasterNodeDelta[];
}

export interface RasterDeltaCapture {
  payload: RasterDeltaPayload | null;
  /** Persist these before the log/revision can refer to them. */
  entries: RasterTileEntry[];
}

const HASH_RE = /^[0-9a-f]{64}$/;
const TILE_KEY_RE = /^-?\d+:-?\d+$/;

function isRasterLayer(node: SceneNode | undefined): node is RasterLayerNode {
  return node?.kind === 'rasterLayer';
}

function tileAt(node: RasterLayerNode | undefined, key: string): RasterTile | undefined {
  return node?.tiles.get(key);
}

function sameTile(a: RasterTile | undefined, b: RasterTile | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.version !== b.version || a.pixels.byteLength !== b.pixels.byteLength) {
    return false;
  }
  for (let i = 0; i < a.pixels.length; i++) {
    if (a.pixels[i] !== b.pixels[i]) return false;
  }
  return true;
}

async function entryFor(
  nodeId: string,
  tileKey: string,
  tile: RasterTile | undefined,
): Promise<{ hash: string | null; version: number | null; entry?: RasterTileEntry }> {
  if (!tile) return { hash: null, version: null };
  const pixels = new Uint8ClampedArray(tile.pixels);
  const contentHash = await hashTilePixels(pixels);
  return {
    hash: contentHash,
    version: tile.version,
    entry: { tileKey: `${nodeId}:${tileKey}`, contentHash, pixels },
  };
}

/**
 * Capture only tiles whose authoritative pixels or stored version changed.
 * Values are copied before the caller yields, so later paint batches cannot
 * mutate the bytes that are about to be persisted.
 */
export async function captureRasterTileDeltas(
  before: Document,
  after: Document,
  transactionId: string,
  hashes: { beforeHash: string; afterHash: string },
): Promise<RasterDeltaCapture> {
  const nodeIds = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
  const nodes: RasterNodeDelta[] = [];
  const entries: RasterTileEntry[] = [];

  for (const nodeId of [...nodeIds].sort()) {
    const beforeNode = before.nodes[nodeId];
    const afterNode = after.nodes[nodeId];
    if (!isRasterLayer(beforeNode) && !isRasterLayer(afterNode)) continue;
    // History replays forward. Deleting a raster node is fully represented by
    // the structural capture; emitting its now-absent tile delta afterwards
    // would target a node that the structural operation has already removed.
    // The pre-image remains reachable through its parent revision.
    if (!isRasterLayer(afterNode)) continue;

    const keys = new Set([
      ...(isRasterLayer(beforeNode) ? beforeNode.tiles.keys() : []),
      ...(isRasterLayer(afterNode) ? afterNode.tiles.keys() : []),
    ]);
    const deltas: RasterTileDelta[] = [];
    for (const tileKey of [...keys].sort()) {
      const beforeTile = tileAt(isRasterLayer(beforeNode) ? beforeNode : undefined, tileKey);
      const afterTile = tileAt(isRasterLayer(afterNode) ? afterNode : undefined, tileKey);
      if (sameTile(beforeTile, afterTile)) continue;
      const [beforeEntry, afterEntry] = await Promise.all([
        entryFor(nodeId, tileKey, beforeTile),
        entryFor(nodeId, tileKey, afterTile),
      ]);
      if (beforeEntry.entry) entries.push(beforeEntry.entry);
      if (afterEntry.entry) entries.push(afterEntry.entry);
      deltas.push({
        tileKey,
        beforeHash: beforeEntry.hash,
        afterHash: afterEntry.hash,
        beforeVersion: beforeEntry.version,
        afterVersion: afterEntry.version,
      });
    }
    if (deltas.length > 0) nodes.push({ nodeId, tiles: deltas });
  }

  return {
    payload:
      nodes.length === 0
        ? null
        : {
            transactionId,
            beforeHash: hashes.beforeHash,
            afterHash: hashes.afterHash,
            nodes,
          },
    entries,
  };
}

export function validateRasterDeltaPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['raster delta payload must be an object'];
  }
  const value = payload as Partial<RasterDeltaPayload>;
  if (typeof value.transactionId !== 'string' || value.transactionId.length === 0) {
    return ['raster delta transactionId is required'];
  }
  if (!HASH_RE.test(value.beforeHash ?? '') || !HASH_RE.test(value.afterHash ?? '')) {
    return ['raster delta document hashes must be lowercase SHA-256 digests'];
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    return ['raster delta requires at least one node'];
  }
  const seenNodes = new Set<string>();
  for (const node of value.nodes) {
    if (!node || typeof node.nodeId !== 'string' || node.nodeId.length === 0) {
      return ['raster delta nodeId is required'];
    }
    if (seenNodes.has(node.nodeId)) return ['raster delta has duplicate node ids'];
    seenNodes.add(node.nodeId);
    if (!Array.isArray(node.tiles) || node.tiles.length === 0) {
      return [`raster delta node ${node.nodeId} has no tiles`];
    }
    const seenTiles = new Set<string>();
    for (const tile of node.tiles) {
      if (!tile || !TILE_KEY_RE.test(tile.tileKey)) {
        return [`raster delta node ${node.nodeId} has an invalid tile key`];
      }
      if (seenTiles.has(tile.tileKey))
        return [`raster delta node ${node.nodeId} has duplicate tiles`];
      seenTiles.add(tile.tileKey);
      for (const hash of [tile.beforeHash, tile.afterHash]) {
        if (hash !== null && !HASH_RE.test(hash)) {
          return [`raster delta node ${node.nodeId} has an invalid tile hash`];
        }
      }
      for (const version of [tile.beforeVersion, tile.afterVersion]) {
        if (version !== null && (!Number.isInteger(version) || version < 1)) {
          return [`raster delta node ${node.nodeId} has an invalid tile version`];
        }
      }
      if ((tile.afterHash === null) !== (tile.afterVersion === null)) {
        return [`raster delta node ${node.nodeId} has inconsistent after tile state`];
      }
      if ((tile.beforeHash === null) !== (tile.beforeVersion === null)) {
        return [`raster delta node ${node.nodeId} has inconsistent before tile state`];
      }
    }
  }
  return [];
}

/** Restore a delta's exact pre- or post-image without invoking a brush. */
export async function applyRasterDelta(
  document: Document,
  payload: RasterDeltaPayload,
  store: RasterTileStore,
  direction: 'before' | 'after' = 'after',
): Promise<Document> {
  const errors = validateRasterDeltaPayload(payload);
  if (errors.length > 0) throw new Error(`invalid raster delta: ${errors.join('; ')}`);

  const requestedHashes = payload.nodes.flatMap((node) =>
    node.tiles
      .map((tile) => (direction === 'after' ? tile.afterHash : tile.beforeHash))
      .filter((hash): hash is string => hash !== null),
  );
  const blobs = await store.getBatch([...new Set(requestedHashes)]);
  for (const hash of requestedHashes) {
    const pixels = blobs.get(hash);
    if (!pixels) throw new Error(`raster tile blob is missing: ${hash}`);
    const actual = await hashTilePixels(pixels);
    if (actual !== hash) throw new Error(`raster tile blob is corrupt: ${hash}`);
  }

  let nodes = document.nodes;
  for (const deltaNode of payload.nodes) {
    const node = nodes[deltaNode.nodeId];
    if (!isRasterLayer(node)) {
      throw new Error(`raster delta target is missing or not a raster layer: ${deltaNode.nodeId}`);
    }
    // A structurally-created raster node is replayed by the generic capture
    // first and intentionally carries `tiles: {}`. Normalize that transport
    // representation at the single history boundary before installing blobs.
    const tiles = new Map(node.tiles instanceof Map ? node.tiles : []);
    for (const delta of deltaNode.tiles) {
      const hash = direction === 'after' ? delta.afterHash : delta.beforeHash;
      const version = direction === 'after' ? delta.afterVersion : delta.beforeVersion;
      if (hash === null || version === null) {
        tiles.delete(delta.tileKey);
      } else {
        const pixels = blobs.get(hash);
        if (!pixels) throw new Error(`raster tile blob is missing: ${hash}`);
        tiles.set(delta.tileKey, { pixels: new Uint8ClampedArray(pixels), version });
      }
    }
    if (nodes === document.nodes) nodes = { ...nodes };
    nodes[deltaNode.nodeId] = { ...node, tiles };
  }
  return nodes === document.nodes ? document : { ...document, nodes };
}

/** Content references required by a delta, for diagnostics and future GC. */
export function rasterDeltaHashes(payload: RasterDeltaPayload): Set<string> {
  const hashes = new Set<string>();
  for (const node of payload.nodes) {
    for (const tile of node.tiles) {
      if (tile.beforeHash) hashes.add(tile.beforeHash);
      if (tile.afterHash) hashes.add(tile.afterHash);
    }
  }
  return hashes;
}
