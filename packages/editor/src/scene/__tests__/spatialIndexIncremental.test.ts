// Incremental spatial-index maintenance.
//
// The snap broad phase caches one spatial index per document and, before this
// suite existed, rebuilt it only when the *document id* changed. A document id
// is stable for the lifetime of the document, so the index was effectively
// built once and never refreshed: a node created or moved after the first drag
// kept its original cell membership forever and could never be returned by the
// broad phase again.
//
// The failure is asymmetric and that is why it survived review. A node that
// moves *out* of the query area is still returned by the stale index, but the
// fine phase re-reads live bounds and drops it, so nothing looks wrong. A node
// that moves *into* the query area is absent from the queried cells, so the
// fine phase never sees it and the object silently stops being snappable.
//
// These tests pin the incremental path: after `updateSpatialIndexNodes` is told
// which node ids changed, queries must agree with a full rebuild.

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { buildSpatialIndex, queryRect, updateSpatialIndexNodes } from '../spatialIndex';

function rectAt(id: string, x: number, y: number, w = 40, h = 40) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w, h },
    { name: id, transform: [1, 0, 0, 1, x, y] as Affine },
  );
}

/** Every node id the index would return for `rect`. */
function idsIn(index: ReturnType<typeof buildSpatialIndex>, rect: Parameters<typeof queryRect>[1]) {
  return [...queryRect(index, rect)].sort();
}

/**
 * Immutable move. The index consumes a plain `Document`, so building the next
 * one directly keeps this suite independent of the scene op surface.
 */
function moveNode(doc: Document, id: string, x: number, y: number): Document {
  const node = doc.nodes[id as NodeId] as SceneNode;
  const moved = { ...node, transform: [1, 0, 0, 1, x, y] as Affine } as SceneNode;
  return { ...doc, nodes: { ...doc.nodes, [id]: moved } } as Document;
}

describe('updateSpatialIndexNodes', () => {
  it('finds a node at its new location after it moves', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('a', 100, 100));
    const index = buildSpatialIndex(doc);

    // Far away from the original position, in a different set of cells.
    const target = { x: 900, y: 900, w: 80, h: 80 };
    expect(idsIn(index, target)).not.toContain('a');

    doc = moveNode(doc, 'a', 920, 920);
    updateSpatialIndexNodes(index, doc, ['a' as NodeId]);

    expect(idsIn(index, target)).toContain('a');
  });

  it('stops returning a node from the cells it left', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('a', 100, 100));
    const index = buildSpatialIndex(doc);
    const origin = { x: 90, y: 90, w: 60, h: 60 };
    expect(idsIn(index, origin)).toContain('a');

    doc = moveNode(doc, 'a', 920, 920);
    updateSpatialIndexNodes(index, doc, ['a' as NodeId]);

    expect(idsIn(index, origin)).not.toContain('a');
  });

  it('indexes a node that did not exist when the index was built', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('a', 100, 100));
    const index = buildSpatialIndex(doc);

    doc = addNode(doc, rectAt('b', 500, 500));
    updateSpatialIndexNodes(index, doc, ['b' as NodeId]);

    expect(idsIn(index, { x: 490, y: 490, w: 60, h: 60 })).toContain('b');
  });

  it('drops a node that was deleted from the document', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('a', 100, 100));
    doc = addNode(doc, rectAt('b', 500, 500));
    const index = buildSpatialIndex(doc);
    expect(idsIn(index, { x: 490, y: 490, w: 60, h: 60 })).toContain('b');

    const { b: _removed, ...remaining } = doc.nodes as Record<string, unknown>;
    doc = { ...doc, nodes: remaining } as Document;
    updateSpatialIndexNodes(index, doc, ['b' as NodeId]);

    expect(idsIn(index, { x: 490, y: 490, w: 60, h: 60 })).not.toContain('b');
  });

  it('agrees with a full rebuild after a sequence of moves', () => {
    let doc = createDocument();
    for (let i = 0; i < 24; i++) {
      doc = addNode(doc, rectAt(`n${i}`, (i % 6) * 130, Math.floor(i / 6) * 130));
    }
    const incremental = buildSpatialIndex(doc);

    // A drag-like sequence: the same node moved repeatedly, then others.
    for (let step = 0; step < 10; step++) {
      doc = moveNode(doc, 'n3', 400 + step * 37, 300 + step * 23);
      updateSpatialIndexNodes(incremental, doc, ['n3' as NodeId]);
    }
    doc = moveNode(doc, 'n17', 12, 940);
    updateSpatialIndexNodes(incremental, doc, ['n17' as NodeId]);

    const rebuilt = buildSpatialIndex(doc);
    const probes = [
      { x: 0, y: 0, w: 200, h: 200 },
      { x: 380, y: 280, w: 300, h: 300 },
      { x: 0, y: 900, w: 200, h: 200 },
      { x: 600, y: 600, w: 400, h: 400 },
    ];
    for (const probe of probes) {
      expect(idsIn(incremental, probe)).toEqual(idsIn(rebuilt, probe));
    }
  });

  it('places a newly added container child at its parent-relative world position', () => {
    // Regression guard for the retained parent map. A node the index has never
    // seen resolves as root unless the map is refreshed, which would file it
    // under its *local* coordinates instead of its world ones.
    let doc = createDocument();
    const frame = makeFrameNode('f1', { name: 'f1', transform: [1, 0, 0, 1, 600, 600] as Affine });
    doc = addNode(doc, frame);
    const index = buildSpatialIndex(doc);

    const child = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
      { name: 'c1', transform: [1, 0, 0, 1, 20, 20] as Affine },
    );
    doc = addChild(doc, 'f1' as NodeId, child);
    updateSpatialIndexNodes(index, doc, ['c1' as NodeId]);

    // World position is (620, 620), not the local (20, 20).
    expect(idsIn(index, { x: 610, y: 610, w: 60, h: 60 })).toContain('c1');
    expect(idsIn(index, { x: 10, y: 10, w: 60, h: 60 })).not.toContain('c1');
  });

  it('leaves no empty cell sets behind', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('a', 100, 100));
    const index = buildSpatialIndex(doc);
    doc = moveNode(doc, 'a', 5000, 5000);
    updateSpatialIndexNodes(index, doc, ['a' as NodeId]);

    // A vacated cell must be removed, not left as an empty Set: the grid is
    // keyed by string and an unbounded set of empty entries is a slow leak on
    // a long drag.
    for (const [, ids] of index.grid) expect(ids.size).toBeGreaterThan(0);
  });

  it('costs work proportional to the changed nodes, not the document', () => {
    let doc = createDocument();
    for (let i = 0; i < 400; i++) {
      doc = addNode(doc, rectAt(`n${i}`, (i % 20) * 90, Math.floor(i / 20) * 90));
    }
    const index = buildSpatialIndex(doc);

    // Counting cell touches is deterministic; wall-clock is not. One moved
    // 40x40 node can occupy at most 4 cells, so removal+insert touches at most
    // 8 — versus 400 nodes rescanned by a full rebuild.
    let touches = 0;
    const grid = index.grid;
    const realDelete = grid.delete.bind(grid);
    const realSet = grid.set.bind(grid);
    const realGet = grid.get.bind(grid);
    grid.delete = (k: string) => {
      touches++;
      return realDelete(k);
    };
    grid.set = (k: string, v: Set<NodeId>) => {
      touches++;
      return realSet(k, v);
    };
    grid.get = (k: string) => {
      touches++;
      return realGet(k);
    };

    doc = moveNode(doc, 'n7', 1500, 1500);
    updateSpatialIndexNodes(index, doc, ['n7' as NodeId]);

    expect(touches).toBeLessThan(40);
  });
});
