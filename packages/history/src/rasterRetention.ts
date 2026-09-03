/**
 * Raster tile retention and reachability-based garbage collection.
 *
 * Tile bytes are written before a revision becomes reachable. A crash in the
 * gap can therefore leave an unreferenced blob, which is safe but wasteful.
 * This module traces every immutable revision operation and snapshot manifest
 * before deleting anything. Callers must run sweeping while history capture is
 * quiesced; otherwise a just-written, not-yet-committed blob looks orphaned.
 */

import {
  RASTER_DELTA_OPERATION,
  type RasterDeltaPayload,
  rasterDeltaHashes,
  validateRasterDeltaPayload,
} from './rasterDelta';
import type { RasterTileStore } from './rasterTileStore';
import { captureSnapshotRasterTiles, snapshotToDocument } from './snapshots';
import type { HistoryStore } from './store';

export interface RasterTileReachability {
  hashes: Set<string>;
  scannedRevisionCount: number;
  scannedSnapshotCount: number;
}

export interface RasterTileGcReport extends RasterTileReachability {
  deletedHashes: string[];
  retainedHashes: string[];
}

/**
 * Find every tile hash retained by immutable revision operations and snapshots.
 * All revisions are retained, including currently unbranched divergence, so a
 * later materialized branch can still replay exactly.
 */
export async function collectReachableRasterTileHashes(
  historyStore: HistoryStore,
  documentId: string,
): Promise<RasterTileReachability> {
  const hashes = new Set<string>();
  const revisions = await historyStore.listRevisions(documentId);
  const snapshots = new Set<string>();

  for (const revision of revisions) {
    if (revision.snapshotId) snapshots.add(revision.snapshotId);
    if (!revision.operationStart || !revision.operationEnd) continue;
    const operations = await historyStore.readOperations(
      documentId,
      revision.operationStart,
      revision.operationEnd,
    );
    for (const operation of operations) {
      if (operation.operationType !== RASTER_DELTA_OPERATION) continue;
      const errors = validateRasterDeltaPayload(operation.payload);
      if (errors.length > 0) {
        throw new Error(
          `cannot safely sweep raster tiles: invalid ${RASTER_DELTA_OPERATION} in ${revision.revisionId}: ${errors.join('; ')}`,
        );
      }
      for (const hash of rasterDeltaHashes(operation.payload as RasterDeltaPayload))
        hashes.add(hash);
    }
  }

  for (const snapshotId of snapshots) {
    const snapshot = await historyStore.getSnapshot(documentId, snapshotId);
    if (!snapshot) {
      throw new Error(`cannot safely sweep raster tiles: snapshot ${snapshotId} is missing`);
    }
    if (snapshot.rasterTileManifest) {
      for (const tile of snapshot.rasterTileManifest) hashes.add(tile.contentHash);
      continue;
    }
    // Snapshots predating the external manifest are still safe to retain. Read
    // their embedded codec bytes instead of guessing, and refuse a lossy one.
    const captured = await captureSnapshotRasterTiles(snapshotToDocument(snapshot));
    for (const tile of captured.manifest) hashes.add(tile.contentHash);
  }

  return {
    hashes,
    scannedRevisionCount: revisions.length,
    scannedSnapshotCount: snapshots.size,
  };
}

/**
 * Delete only content-addressed blobs that no revision or snapshot can reach.
 * The report is deterministic (lexicographically sorted) for diagnostics and
 * tests. This is deliberately not an automatic background task: callers must
 * serialize it with capture/commit ordering.
 */
export async function sweepUnreachableRasterTiles(
  historyStore: HistoryStore,
  tileStore: RasterTileStore,
  documentId: string,
): Promise<RasterTileGcReport> {
  const reachability = await collectReachableRasterTileHashes(historyStore, documentId);
  const stored = await tileStore.listHashes();
  const deletedHashes = stored.filter((hash) => !reachability.hashes.has(hash));
  if (deletedHashes.length) await tileStore.deleteBatch(deletedHashes);
  return {
    ...reachability,
    deletedHashes,
    retainedHashes: stored.filter((hash) => reachability.hashes.has(hash)),
  };
}
