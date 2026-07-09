import { createDocument, makeShapeNode, type SceneNode, type Document } from '@strata/scene';
import {
  alignBBox,
  type BBox,
  computeAlignmentTarget,
  computeDistribution,
  computeTidyLayout,
  orientedBBox,
  obbAlignmentTarget,
} from '@strata/shared';
import { identity } from '@strata/shared';
import { nodeWorldBounds } from '../../scene/world';
import { describe, expect, it } from 'vitest';

function makeRect(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w, h },
    {
      transform: [1, 0, 0, 1, x, y],
      name: id,
    },
  ) as SceneNode;
}

function addToDoc(doc: Document, ...nodes: SceneNode[]): Document {
  const entries = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  const existing = doc.nodes;
  return {
    ...doc,
    rootChildren: [...doc.rootChildren, ...ids],
    nodes: { ...existing, ...entries },
  };
}

function getBounds(doc: Document, ids: string[]): BBox[] {
  return ids.map((id) => nodeWorldBounds(doc, id)).filter((b): b is BBox => b !== null);
}

describe('alignSelected — alignment logic', () => {
  it('align 3 rects to left edge', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 10, 0, 20, 10),
      makeRect('r2', 50, 20, 30, 15),
      makeRect('r3', 0, 40, 10, 20),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    expect(bounds).toHaveLength(3);

    const target = computeAlignmentTarget('left', bounds);
    expect(target).not.toBeNull();
    if (!target) return;
    expect(target.left).toBe(0);

    for (const b of bounds) {
      const pos = alignBBox(b, 'left', target);
      expect(pos.x).toBe(0);
    }
  });

  it('align 3 rects to center horizontally', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 0, 10, 10),
      makeRect('r2', 30, 0, 20, 10),
      makeRect('r3', 100, 0, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    expect(bounds).toHaveLength(3);

    const target = computeAlignmentTarget('centerH', bounds);
    expect(target).not.toBeNull();
    if (!target) return;
    // Union: x=0, right=110 → centerX=55
    expect(Math.abs(target.centerX - 55)).toBeLessThan(1e-9);

    for (const b of bounds) {
      const pos = alignBBox(b, 'centerH', target);
      expect(pos.x).toBe(target.centerX - b.w / 2);
    }
  });

  it('align 3 rects to right edge', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 10, 0, 20, 10),
      makeRect('r2', 50, 0, 30, 10),
      makeRect('r3', 0, 0, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    const target = computeAlignmentTarget('right', bounds);
    expect(target).not.toBeNull();
    if (!target) return;
    expect(target.right).toBe(80);

    for (const b of bounds) {
      const pos = alignBBox(b, 'right', target);
      expect(pos.x).toBe(target.right - b.w);
    }
  });

  it('align 3 rects to top edge', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 10, 10, 20),
      makeRect('r2', 0, 50, 10, 30),
      makeRect('r3', 0, 0, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    const target = computeAlignmentTarget('top', bounds);
    expect(target).not.toBeNull();
    if (!target) return;
    expect(target.top).toBe(0);

    for (const b of bounds) {
      const pos = alignBBox(b, 'top', target);
      expect(pos.y).toBe(0);
    }
  });

  it('align 3 rects to center vertically', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 0, 10, 10),
      makeRect('r2', 0, 30, 10, 20),
      makeRect('r3', 0, 100, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    const target = computeAlignmentTarget('centerV', bounds);
    expect(target).not.toBeNull();
    if (!target) return;
    // Union: y=0, bottom=110 → centerY=55
    expect(Math.abs(target.centerY - 55)).toBeLessThan(1e-9);

    for (const b of bounds) {
      const pos = alignBBox(b, 'centerV', target);
      expect(pos.y).toBe(target.centerY - b.h / 2);
    }
  });

  it('align 3 rects to bottom edge', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 10, 10, 20),
      makeRect('r2', 0, 0, 10, 30),
      makeRect('r3', 0, 50, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    const target = computeAlignmentTarget('bottom', bounds);
    expect(target).not.toBeNull();
    if (!target) return;
    expect(target.bottom).toBe(60);

    for (const b of bounds) {
      const pos = alignBBox(b, 'bottom', target);
      expect(pos.y).toBe(target.bottom - b.h);
    }
  });

  it('align with fewer than 2 items returns null target', () => {
    const base = createDocument('test');
    const doc = addToDoc(base, makeRect('r1', 0, 0, 10, 10));
    const bounds = getBounds(doc, ['r1']);
    const target = computeAlignmentTarget('left', bounds);
    expect(target).toBeNull();
  });
});

describe('distributeSelected — distribution logic', () => {
  it('distribute 3 rects horizontally with even spacing', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 0, 10, 10),
      makeRect('r2', 20, 0, 10, 10),
      makeRect('r3', 40, 0, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    expect(bounds).toHaveLength(3);

    const positions = computeDistribution('horizontal', bounds);
    expect(positions).not.toBeNull();
    if (!positions) return;
    // Sorted: 0→20→40
    // start=0, end=50, totalSize=30, gap=(50-30)/2=10
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(20);
    expect(positions[2]).toBe(40);
  });

  it('distribute 3 rects vertically with even spacing', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 0, 10, 10),
      makeRect('r2', 0, 20, 10, 10),
      makeRect('r3', 0, 40, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    const positions = computeDistribution('vertical', bounds);
    expect(positions).not.toBeNull();
    if (!positions) return;
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(20);
    expect(positions[2]).toBe(40);
  });

  it('distribute with fewer than 3 items returns null', () => {
    const base = createDocument('test');
    const doc = addToDoc(base, makeRect('r1', 0, 0, 10, 10), makeRect('r2', 20, 0, 10, 10));
    const bounds = getBounds(doc, ['r1', 'r2']);
    expect(computeDistribution('horizontal', bounds)).toBeNull();
  });

  it('distribute 3 rects with fixed gap of 5 world units', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 0, 10, 10),
      makeRect('r2', 30, 0, 10, 10),
      makeRect('r3', 100, 0, 10, 10),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3']);
    const positions = computeDistribution('horizontal', bounds, 5);
    expect(positions).not.toBeNull();
    if (!positions) return;
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(15); // 0 + 10 + 5
    expect(positions[2]).toBe(30); // 15 + 10 + 5
  });
});

describe('tidySelected — grid layout logic', () => {
  it('arranges 4 rects into a 2x2 grid', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 0, 0, 20, 20),
      makeRect('r2', 30, 0, 20, 20),
      makeRect('r3', 0, 30, 20, 20),
      makeRect('r4', 30, 30, 20, 20),
    );
    const bounds = getBounds(doc, ['r1', 'r2', 'r3', 'r4']);
    expect(bounds).toHaveLength(4);

    const result = computeTidyLayout(bounds, 4);
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(2);

    // Row 0: r1 (idx 0), r2 (idx 1)
    expect(result.assignments[0]![0]).toBe(0);
    expect(result.assignments[0]![1]).toBe(0);
    expect(result.assignments[1]![0]).toBe(0);
    expect(result.assignments[1]![1]).toBe(1);

    // Row 1: r3 (idx 2), r4 (idx 3)
    expect(result.assignments[2]![0]).toBe(1);
    expect(result.assignments[2]![1]).toBe(0);
    expect(result.assignments[3]![0]).toBe(1);
    expect(result.assignments[3]![1]).toBe(1);

    expect(result.colWidth).toBe(20);
    expect(result.rowHeight).toBe(20);
  });

  it('produces 1x1 layout for single item', () => {
    const base = createDocument('test');
    const doc = addToDoc(base, makeRect('r1', 0, 0, 10, 10));
    const bounds = getBounds(doc, ['r1']);
    const result = computeTidyLayout(bounds, 4);
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(1);
    expect(result.assignments).toEqual([[0, 0]]);
  });
});

describe('key object alignment', () => {
  it('aligns r1 to r2s left edge using key object target', () => {
    const base = createDocument('test');
    const doc = addToDoc(
      base,
      makeRect('r1', 10, 10, 20, 20),
      makeRect('r2', 50, 50, 30, 30),
      makeRect('r3', 100, 100, 10, 10),
    );
    const keyBounds = nodeWorldBounds(doc, 'r2');
    expect(keyBounds).not.toBeNull();
    if (!keyBounds) return;

    const target = {
      left: keyBounds.x,
      right: keyBounds.x + keyBounds.w,
      top: keyBounds.y,
      bottom: keyBounds.y + keyBounds.h,
      centerX: keyBounds.x + keyBounds.w / 2,
      centerY: keyBounds.y + keyBounds.h / 2,
    };

    const r1Bounds = nodeWorldBounds(doc, 'r1');
    expect(r1Bounds).not.toBeNull();
    if (!r1Bounds) return;
    const pos = alignBBox(r1Bounds, 'left', target);
    expect(pos.x).toBe(keyBounds.x);
  });
});

describe('align-to-page', () => {
  it('page bounds target uses canvas dimensions', () => {
    const base = createDocument('test');
    const doc = { ...base, canvasWidth: 1920, canvasHeight: 1080 } as Document;
    const pw = 1920;
    const ph = 1080;
    const target = { left: 0, right: pw, top: 0, bottom: ph, centerX: pw / 2, centerY: ph / 2 };

    const inserted = addToDoc(doc, makeRect('r1', 100, 100, 50, 50));
    const b = nodeWorldBounds(inserted, 'r1');
    expect(b).not.toBeNull();
    if (!b) return;

    const pos = alignBBox(b, 'centerH', target);
    expect(pos.x).toBe(pw / 2 - b.w / 2);
  });
});

describe('OBB alignment', () => {
  it('orientedBBox for identity transform yields axis-aligned box', () => {
    const obb = orientedBBox(identity, 10, 20);
    expect(obb).toHaveLength(4);
    expect(obb[0]).toEqual([0, 0]);
    expect(obb[1]).toEqual([10, 0]);
    expect(obb[2]).toEqual([10, 20]);
    expect(obb[3]).toEqual([0, 20]);
  });

  it('obbAlignmentTarget computes left edge for 2 OBBs', () => {
    const obb1 = orientedBBox(identity, 10, 10);
    const obb2 = orientedBBox([1, 0, 0, 1, 30, 0], 10, 10);
    expect(obbAlignmentTarget('left', [obb1, obb2])).toBe(0);
  });
});
