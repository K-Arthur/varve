import type { BrushDab, Document } from '@varve/scene';
import {
  canonicalHistoryHash,
  compositeDabOnNode,
  createDocument,
  makeRasterLayerNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { applyRasterDelta, captureRasterTileDeltas, rasterDeltaHashes } from '../rasterDelta';
import { MemoryRasterTileStore } from '../rasterTileStore';
import { createSnapshot, snapshotToDocument } from '../snapshots';
import { createMemoryHistoryStore } from '../store';

function rasterDocument(): Document {
  const layer = makeRasterLayerNode('raster_1', { width: 256, height: 256 });
  return {
    ...createDocument('raster-history', { flat: true }),
    nodes: { raster_1: layer },
    rootChildren: ['raster_1'],
  } as Document;
}

function dab(x: number, y: number, radius: number, opacity = 1, flow = 1, hardness = 1): BrushDab {
  return {
    x,
    y,
    radius,
    opacity,
    flow,
    hardness,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

describe('exact raster tile deltas', () => {
  it('restores committed pixels without invoking the brush algorithm during replay', async () => {
    const before = rasterDocument();
    const layer = before.nodes.raster_1!;
    expect(layer.kind).toBe('rasterLayer');
    const painted = compositeDabOnNode(
      layer as Extract<typeof layer, { kind: 'rasterLayer' }>,
      dab(48.25, 64.5, 11.5, 0.83, 0.76, 0.41),
      [24, 190, 171, 255],
    );
    const after: Document = { ...before, nodes: { ...before.nodes, raster_1: painted } };
    const capture = await captureRasterTileDeltas(before, after, 'tx-raster', {
      beforeHash: canonicalHistoryHash(before),
      afterHash: canonicalHistoryHash(after),
    });
    expect(capture.payload).not.toBeNull();
    expect(capture.payload!.nodes).toHaveLength(1);
    expect(capture.entries.length).toBeGreaterThan(0);

    const store = new MemoryRasterTileStore();
    await store.putBatch(capture.entries);
    const replayed = await applyRasterDelta(before, capture.payload!, store);
    expect(canonicalHistoryHash(replayed)).toBe(canonicalHistoryHash(after));

    const restored = await applyRasterDelta(replayed, capture.payload!, store, 'before');
    expect(canonicalHistoryHash(restored)).toBe(canonicalHistoryHash(before));
  });

  it('deduplicates a shared pre-image and treats absent tiles explicitly', async () => {
    const before = rasterDocument();
    const layer = before.nodes.raster_1!;
    expect(layer.kind).toBe('rasterLayer');
    const first = compositeDabOnNode(
      layer as Extract<typeof layer, { kind: 'rasterLayer' }>,
      dab(20, 20, 5),
      [255, 0, 0, 255],
    );
    const after: Document = { ...before, nodes: { ...before.nodes, raster_1: first } };
    const capture = await captureRasterTileDeltas(before, after, 'tx-absent', {
      beforeHash: canonicalHistoryHash(before),
      afterHash: canonicalHistoryHash(after),
    });
    const tile = capture.payload!.nodes[0]!.tiles[0]!;
    expect(tile.beforeHash).toBeNull();
    expect(tile.beforeVersion).toBeNull();
    expect(tile.afterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rasterDeltaHashes(capture.payload!).has(tile.afterHash!)).toBe(true);
  });

  it('rehydrates raster tile Maps from a snapshot without losing pixels', async () => {
    const before = rasterDocument();
    const layer = before.nodes.raster_1!;
    expect(layer.kind).toBe('rasterLayer');
    const after: Document = {
      ...before,
      nodes: {
        ...before.nodes,
        raster_1: compositeDabOnNode(
          layer as Extract<typeof layer, { kind: 'rasterLayer' }>,
          dab(90, 90, 9, 1, 1, 0.6),
          [0, 0, 0, 255],
        ),
      },
    };
    const snapshot = await createSnapshot(createMemoryHistoryStore(), after, {
      documentId: after.id,
      revisionId: 'r-raster',
    });
    const restored = snapshotToDocument(snapshot);
    expect(canonicalHistoryHash(restored)).toBe(canonicalHistoryHash(after));
    expect(restored.nodes.raster_1).toMatchObject({ kind: 'rasterLayer' });
    expect(
      (restored.nodes.raster_1 as Extract<typeof layer, { kind: 'rasterLayer' }>).tiles,
    ).toBeInstanceOf(Map);
  });
});
