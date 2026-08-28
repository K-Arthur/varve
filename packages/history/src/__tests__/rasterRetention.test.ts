import type { BrushDab, Document } from '@varve/scene';
import {
  canonicalHistoryHash,
  compositeDabOnNode,
  createDocument,
  makeRasterLayerNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { captureRasterTileDeltas, RASTER_DELTA_OPERATION } from '../rasterDelta';
import { sweepUnreachableRasterTiles } from '../rasterRetention';
import { hashTilePixels, MemoryRasterTileStore } from '../rasterTileStore';
import { buildRevision, createGenesisRevision } from '../revisions';
import { createMemoryHistoryStore } from '../store';
import type { StoredOperation } from '../types';

const DOCUMENT_ID = 'raster-retention';

function rasterDocument(): Document {
  const layer = makeRasterLayerNode('raster', { width: 128, height: 128 });
  return {
    ...createDocument(DOCUMENT_ID, { flat: true }),
    nodes: { raster: layer },
    rootChildren: ['raster'],
  } as Document;
}

function dab(): BrushDab {
  return {
    x: 40.5,
    y: 53.25,
    radius: 8.75,
    opacity: 0.8,
    flow: 0.7,
    hardness: 0.5,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

describe('raster tile retention', () => {
  it('keeps every revision-reachable blob and sweeps a pre-commit orphan', async () => {
    const history = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const before = rasterDocument();
    const { genesis, branch } = await createGenesisRevision(history, before, {
      documentId: DOCUMENT_ID,
      author: { actorId: 'test', kind: 'local-user' },
      rasterTileStore: tiles,
    });
    const layer = before.nodes.raster;
    expect(layer?.kind).toBe('rasterLayer');
    const after: Document = {
      ...before,
      nodes: {
        ...before.nodes,
        raster: compositeDabOnNode(
          layer as Extract<typeof layer, { kind: 'rasterLayer' }>,
          dab(),
          [44, 170, 210, 255],
        ),
      },
    };
    const capture = await captureRasterTileDeltas(before, after, 'tx-retention', {
      beforeHash: canonicalHistoryHash(before),
      afterHash: canonicalHistoryHash(after),
    });
    await tiles.putBatch(capture.entries);
    const operation: StoredOperation = {
      operationId: 'op-retention',
      operationType: RASTER_DELTA_OPERATION,
      schemaVersion: 1,
      logicalSequence: 0,
      affectedEntityIds: ['raster'],
      payload: capture.payload!,
    };
    const start = await history.appendOperations(DOCUMENT_ID, [operation]);
    const revision = buildRevision({
      document: after,
      documentId: DOCUMENT_ID,
      parentRevisionIds: [genesis.revisionId],
      author: { actorId: 'test', kind: 'local-user' },
      origin: 'edit',
      semanticSummary: { label: 'Paint', kind: 'paint', affectedEntityIds: ['raster'] },
      operationStart: start,
      operationEnd: { segment: start.segment, offset: start.offset + 1 },
    });
    await history.commitRevision({
      revision,
      moveBranchHead: { branchId: branch.branchId, headRevisionId: revision.revisionId },
    });

    const orphanPixels = new Uint8ClampedArray([1, 2, 3, 4]);
    const orphanHash = await hashTilePixels(orphanPixels);
    await tiles.put({ tileKey: 'orphan:0:0', contentHash: orphanHash, pixels: orphanPixels });

    const report = await sweepUnreachableRasterTiles(history, tiles, DOCUMENT_ID);
    expect(report.scannedRevisionCount).toBe(2);
    expect(report.deletedHashes).toEqual([orphanHash]);
    expect(await tiles.has(orphanHash)).toBe(false);
    for (const entry of capture.entries) expect(await tiles.has(entry.contentHash)).toBe(true);
  });
});
