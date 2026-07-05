import type { Affine } from '@strata/shared';
import type { NodeId } from '@strata/scene';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import {
  buildSpatialIndex,
  cellKey,
  getOrCreateSpatialIndex,
  invalidateSpatialIndex,
  queryPoint,
  queryRect,
  rectCells,
} from '../spatialIndex';

function buildDoc() {
  let doc = createDocument();

  // Root rect at (100, 100) size 50x50 -> world bounds (100, 100, 50, 50)
  const rectA = makeShapeNode(
    'n1',
    { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    { name: 'RectA', transform: [1, 0, 0, 1, 100, 100] as Affine },
  );
  doc = addNode(doc, rectA);

  // Another rect at (200, 200) size 30x30 -> world bounds (200, 200, 30, 30)
  const rectB = makeShapeNode(
    'n2',
    { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
    { name: 'RectB', transform: [1, 0, 0, 1, 200, 200] as Affine },
  );
  doc = addNode(doc, rectB);

  // Frame at (0, 300) size 200x160 -> world bounds (0, 300, 200, 160)
  const frame = makeFrameNode('n3', {
    name: 'FrameC',
    transform: [1, 0, 0, 1, 0, 300] as Affine,
  });
  doc = addNode(doc, frame);

  // Node inside frame at local (10, 10) -> world (10, 310) size 20x20 -> bounds (10, 310, 20, 20)
  const child = makeShapeNode(
    'n4',
    { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
    { name: 'Child', transform: [1, 0, 0, 1, 10, 10] as Affine },
  );
  doc = addChild(doc, 'n3', child);

  return doc;
}

describe('cellKey', () => {
  it('produces deterministic keys', () => {
    expect(cellKey(0, 0)).toBe('0,0');
    expect(cellKey(63, 63)).toBe('0,0');
    expect(cellKey(64, 0)).toBe('1,0');
    expect(cellKey(0, 64)).toBe('0,1');
    expect(cellKey(64, 64)).toBe('1,1');
    expect(cellKey(-1, -1)).toBe('-1,-1');
  });
});

describe('rectCells', () => {
  it('produces correct cell coverage for a small rect within one cell', () => {
    const cells = rectCells({ x: 10, y: 10, w: 20, h: 20 });
    expect(cells).toEqual(['0,0']);
  });

  it('produces correct cell coverage spanning multiple cells', () => {
    const cells = rectCells({ x: 10, y: 10, w: 100, h: 100 });
    // spans x: cells 0,1 and y: cells 0,1
    expect(cells.sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('handles rect on cell boundary', () => {
    // rect from x=0 to x=64 exactly touches cell 0 and cell 1
    const cells = rectCells({ x: 0, y: 0, w: 64, h: 64 });
    expect(cells.sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('handles rect entirely within one cell', () => {
    const cells = rectCells({ x: 30, y: 30, w: 10, h: 10 });
    expect(cells.sort()).toEqual(['0,0']);
  });
});

describe('buildSpatialIndex', () => {
  it('builds index with correct cell count', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    // RectA: bounds (100,100,50,50) -> cells (1,1),(1,2),(2,1),(2,2)
    // RectB: bounds (200,200,30,30) -> cells (3,3),(3,4),(4,3),(4,4)
    // FrameC: bounds (0,300,200,160) -> cells (0,4),(0,5),(0,6),(1,4),(1,5),(1,6),(2,4),(2,5),(2,6),(3,4),(3,5)
    // Child: bounds (10,310,20,20) -> cells (0,4)
    // At least 4 unique cells
    expect(index.grid.size).toBeGreaterThanOrEqual(4);
  });

  it('indexes all nodes', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    // Count all node IDs across all cells (deduplicated)
    const allIds = new Set<NodeId>();
    for (const ids of index.grid.values()) {
      for (const id of ids) allIds.add(id);
    }
    // Should have n1, n2, n3, n4 (but not the contentRoot group since groups return null bounds)
    expect(allIds.has('n1')).toBe(true);
    expect(allIds.has('n2')).toBe(true);
    expect(allIds.has('n3')).toBe(true);
    expect(allIds.has('n4')).toBe(true);
  });

  it('handles nodes with null world bounds (groups)', () => {
    let doc = createDocument();
    // Add a group (which has no inherent geometry — nodeWorldBounds returns null)
    const group = makeGroupNode('g1', { name: 'Group' });
    doc = addNode(doc, group);
    const index = buildSpatialIndex(doc);
    // The group should not appear in any cell
    for (const ids of index.grid.values()) {
      expect(ids.has('g1')).toBe(false);
    }
  });
});

describe('queryPoint', () => {
  it('returns node at that position', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    // RectA is at world (100,100,50,50), so (120,120) should hit it
    const candidates = queryPoint(index, 120, 120);
    expect(candidates.has('n1')).toBe(true);
  });

  it('returns empty Set for empty area', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    const candidates = queryPoint(index, 9999, 9999);
    expect(candidates.size).toBe(0);
  });

  it('returns multiple nodes in the same cell', () => {
    let doc = createDocument();
    // Two rects in same cell (0,0)
    const r1 = makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'R1' });
    doc = addNode(doc, r1);
    const r2 = makeShapeNode('r2', { kind: 'rect', x: 20, y: 20, w: 10, h: 10 }, { name: 'R2' });
    doc = addNode(doc, r2);
    const index = buildSpatialIndex(doc);
    const candidates = queryPoint(index, 5, 5);
    expect(candidates.has('r1')).toBe(true);
    expect(candidates.has('r2')).toBe(true);
  });

  it('returns candidates within CELL_SIZE radius via cell membership', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    // Point (120, 120) is inside RectA's cell (cells(100,100)-(150,150) spans cells (1,1),(1,2),(2,1),(2,2))
    // (120,120) is in cell (1,1)
    const candidates = queryPoint(index, 120, 120);
    expect(candidates.has('n1')).toBe(true);
  });
});

describe('queryRect', () => {
  it('returns nodes in rect', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    // Rect covering (100,100) to (150,150) — overlaps RectA
    const candidates = queryRect(index, { x: 80, y: 80, w: 80, h: 80 });
    expect(candidates.has('n1')).toBe(true);
  });

  it('returns nodes spanning multiple cells', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    // Large rect covering (0,0) to (400,400) — should find all root nodes
    const candidates = queryRect(index, { x: 0, y: 0, w: 400, h: 400 });
    expect(candidates.has('n1')).toBe(true);
    expect(candidates.has('n2')).toBe(true);
    expect(candidates.has('n3')).toBe(true);
    expect(candidates.has('n4')).toBe(true);
  });

  it('returns empty set for rect in empty area', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    const candidates = queryRect(index, { x: 9999, y: 9999, w: 10, h: 10 });
    expect(candidates.size).toBe(0);
  });

  it('returns unique nodes (no duplicates if node spans multiple cells)', () => {
    let doc = createDocument();
    // Large node spanning many cells
    const big = makeShapeNode('big', { kind: 'rect', x: 0, y: 0, w: 500, h: 500 }, { name: 'Big' });
    doc = addNode(doc, big);
    const index = buildSpatialIndex(doc);
    const candidates = queryRect(index, { x: 0, y: 0, w: 500, h: 500 });
    // Should appear exactly once
    expect(candidates.size).toBe(1);
    expect(candidates.has('big')).toBe(true);
  });
});

describe('getOrCreateSpatialIndex', () => {
  it('returns cached when docRef matches', () => {
    const doc = buildDoc();
    const index = buildSpatialIndex(doc);
    const cached = getOrCreateSpatialIndex(doc, index);
    // Should be the same object
    expect(cached).toBe(index);
    expect(cached.docRef).toBe(doc);
  });

  it('rebuilds when docRef changes', () => {
    const doc1 = buildDoc();
    const doc2 = buildDoc();
    const index = buildSpatialIndex(doc1);
    const rebuilt = getOrCreateSpatialIndex(doc2, index);
    // Should be different object since docRef differs
    expect(rebuilt).not.toBe(index);
    expect(rebuilt.docRef).toBe(doc2);
  });

  it('rebuilds when existing is null', () => {
    const doc = buildDoc();
    const index = getOrCreateSpatialIndex(doc, null);
    expect(index.docRef).toBe(doc);
    expect(index.grid.size).toBeGreaterThan(0);
  });
});

describe('invalidateSpatialIndex', () => {
  it('returns null', () => {
    expect(invalidateSpatialIndex()).toBe(null);
  });
});
