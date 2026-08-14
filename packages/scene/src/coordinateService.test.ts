import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  artboardLocalToWorld,
  artboardRectToWorld,
  bakeRotationIntoTransform,
  computeReparentPosition,
  computeReparentTransform,
  findArtboardForNode,
  getAllArtboards,
  getArtboardWorldOrigin,
  getArtboardWorldRect,
  isArtboard,
  localRectToWorld,
  localSpaceTransform,
  localToWorld,
  migrateRotationToTransform,
  nodeWorldBounds,
  nodeWorldTransform,
  validateDocumentTransforms,
  worldToArtboardLocal,
  worldToLocal,
} from './coordinateService';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from './document';

const EPS = 1e-9;

function makeRect(id: string, transform: Affine = [1, 0, 0, 1, 0, 0]) {
  return makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { transform });
}

describe('CoordinateService — point conversions', () => {
  it('localToWorld applies world transform to a point', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 200, 300]));

    const world = localToWorld(doc, 's1', [10, 20]);
    expect(world[0]).toBeCloseTo(210, EPS);
    expect(world[1]).toBeCloseTo(320, EPS);
  });

  it('worldToLocal inverts localToWorld', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 200, 300]));

    const world = localToWorld(doc, 's1', [10, 20]);
    const local = worldToLocal(doc, 's1', world);
    expect(local![0]).toBeCloseTo(10, EPS);
    expect(local![1]).toBeCloseTo(20, EPS);
  });

  it('round-trips through nested transforms', () => {
    let doc = createDocument();
    const frame = makeFrameNode('f1', {
      transform: [1, 0, 0, 1, 100, 100],
    });
    doc = addNode(doc, frame);
    const child = makeRect('s1', [1, 0, 0, 1, 50, 25]);
    doc = addChild(doc, 'f1', child);

    // Child local (10, 10) → world
    const world = localToWorld(doc, 's1', [10, 10]);
    expect(world[0]).toBeCloseTo(160, EPS); // 100 + 50 + 10
    expect(world[1]).toBeCloseTo(135, EPS); // 100 + 25 + 10

    // World → child local
    const local = worldToLocal(doc, 's1', world);
    expect(local![0]).toBeCloseTo(10, EPS);
    expect(local![1]).toBeCloseTo(10, EPS);
  });

  it('handles rotated transforms in round-trip', () => {
    let doc = createDocument();
    // 90-degree rotation + translation
    const angle = (90 * Math.PI) / 180;
    const transform: Affine = [
      Math.cos(angle),
      Math.sin(angle),
      -Math.sin(angle),
      Math.cos(angle),
      100,
      200,
    ];
    doc = addNode(doc, makeRect('s1', transform));

    const localPoint: [number, number] = [10, 20];
    const world = localToWorld(doc, 's1', localPoint);
    const back = worldToLocal(doc, 's1', world);
    expect(back![0]).toBeCloseTo(localPoint[0], 6);
    expect(back![1]).toBeCloseTo(localPoint[1], 6);
  });

  it('worldToLocal returns null for non-invertible transform', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [0, 0, 0, 0, 100, 200]));

    const result = worldToLocal(doc, 's1', [10, 20]);
    expect(result).toBeNull();
  });
});

describe('CoordinateService — rectangle conversions', () => {
  it('localRectToWorld transforms a rect to world space', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 100, 200]));

    const world = localRectToWorld(doc, 's1', { x: 0, y: 0, w: 100, h: 50 });
    expect(world.x).toBeCloseTo(100, EPS);
    expect(world.y).toBeCloseTo(200, EPS);
    expect(world.w).toBeCloseTo(100, EPS);
    expect(world.h).toBeCloseTo(50, EPS);
  });

  it('worldRectToLocal inverts localRectToWorld', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 100, 200]));

    const worldRect = localRectToWorld(doc, 's1', { x: 0, y: 0, w: 100, h: 50 });
    const local = worldToLocal(doc, 's1', [worldRect.x + 10, worldRect.y + 10]);
    expect(local![0]).toBeCloseTo(10, EPS);
    expect(local![1]).toBeCloseTo(10, EPS);
  });
});

describe('CoordinateService — localSpaceTransform', () => {
  it('computes transform between sibling nodes', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 100, 100]));
    doc = addNode(doc, makeRect('s2', [1, 0, 0, 1, 200, 200]));

    const t = localSpaceTransform(doc, 's1', 's2')!;
    expect(t).not.toBeNull();
    // s1 local (0,0) → s2 local should be (-100, -100)
    const s2Local = worldToLocal(doc, 's2', localToWorld(doc, 's1', [0, 0]));
    expect(s2Local![0]).toBeCloseTo(-100, EPS);
    expect(s2Local![1]).toBeCloseTo(-100, EPS);
  });

  it('returns null for non-invertible target', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 100, 100]));
    doc = addNode(doc, makeRect('s2', [0, 0, 0, 0, 200, 200]));

    const t = localSpaceTransform(doc, 's1', 's2');
    expect(t).toBeNull();
  });
});

describe('CoordinateService — artboard detection', () => {
  it('identifies root-level frames as artboards', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 0, 0] }));

    expect(isArtboard(doc, 'f1')).toBe(true);
  });

  it('does not identify nested frames as artboards', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 0, 0] }));
    const inner = makeFrameNode('f2', { transform: [1, 0, 0, 1, 10, 10] });
    doc = addChild(doc, 'f1', inner);

    expect(isArtboard(doc, 'f1')).toBe(true);
    expect(isArtboard(doc, 'f2')).toBe(false);
  });

  it('does not identify groups as artboards', () => {
    let doc = createDocument();
    doc = addNode(doc, makeGroupNode('g1', { transform: [1, 0, 0, 1, 0, 0] }));

    expect(isArtboard(doc, 'g1')).toBe(false);
  });

  it('finds artboard for nested node', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 0, 0] }));
    const child = makeRect('s1', [1, 0, 0, 1, 10, 10]);
    doc = addChild(doc, 'f1', child);

    expect(findArtboardForNode(doc, 's1')).toBe('f1');
    expect(findArtboardForNode(doc, 'f1')).toBe('f1');
  });

  it('returns null for node outside any artboard', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 0, 0]));

    expect(findArtboardForNode(doc, 's1')).toBeNull();
  });

  it('gets artboard world origin', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 100, 200] }));

    const origin = getArtboardWorldOrigin(doc, 'f1');
    expect(origin[0]).toBeCloseTo(100, EPS);
    expect(origin[1]).toBeCloseTo(200, EPS);
  });

  it('gets artboard world rect', () => {
    let doc = createDocument();
    const frame = makeFrameNode('f1', { transform: [1, 0, 0, 1, 50, 60] });
    frame.w = 300;
    frame.h = 200;
    doc = addNode(doc, frame);

    const rect = getArtboardWorldRect(doc, 'f1')!;
    expect(rect.x).toBeCloseTo(50, EPS);
    expect(rect.y).toBeCloseTo(60, EPS);
    expect(rect.w).toBeCloseTo(300, EPS);
    expect(rect.h).toBeCloseTo(200, EPS);
  });

  it('lists all artboards', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 0, 0] }));
    doc = addNode(doc, makeFrameNode('f2', { transform: [1, 0, 0, 1, 500, 0] }));
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 0, 0]));

    const artboards = getAllArtboards(doc);
    expect(artboards).toContain('f1');
    expect(artboards).toContain('f2');
    expect(artboards).not.toContain('s1');
  });
});

describe('CoordinateService — artboard coordinate conversions', () => {
  it('converts world to artboard-local and back', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 100, 200] }));

    const worldPoint: [number, number] = [150, 250];
    const local = worldToArtboardLocal(doc, 'f1', worldPoint)!;
    expect(local[0]).toBeCloseTo(50, EPS);
    expect(local[1]).toBeCloseTo(50, EPS);

    const back = artboardLocalToWorld(doc, 'f1', local);
    expect(back[0]).toBeCloseTo(150, EPS);
    expect(back[1]).toBeCloseTo(250, EPS);
  });

  it('converts artboard-local rect to world', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 100, 200] }));

    const worldRect = artboardRectToWorld(doc, 'f1', { x: 10, y: 20, w: 30, h: 40 });
    expect(worldRect.x).toBeCloseTo(110, EPS);
    expect(worldRect.y).toBeCloseTo(220, EPS);
    expect(worldRect.w).toBeCloseTo(30, EPS);
    expect(worldRect.h).toBeCloseTo(40, EPS);
  });
});

describe('CoordinateService — reparenting', () => {
  it('preserves world position when reparenting', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 100, 100] }));
    doc = addNode(doc, makeFrameNode('f2', { transform: [1, 0, 0, 1, 500, 500] }));
    const child = makeRect('s1', [1, 0, 0, 1, 50, 50]);
    doc = addChild(doc, 'f1', child);

    // Child world position: (100+50, 100+50) = (150, 150)
    const oldWorld = nodeWorldTransform(doc, 's1');
    expect(oldWorld[4]).toBeCloseTo(150, EPS);
    expect(oldWorld[5]).toBeCloseTo(150, EPS);

    // Compute new local transform for reparenting to f2
    const newLocal = computeReparentTransform(doc, 's1', 'f2')!;
    // f2 is at (500, 500), so new local should be (150-500, 150-500) = (-350, -350)
    expect(newLocal[4]).toBeCloseTo(-350, EPS);
    expect(newLocal[5]).toBeCloseTo(-350, EPS);
  });

  it('preserves world position when moving to root', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 100, 100] }));
    const child = makeRect('s1', [1, 0, 0, 1, 50, 50]);
    doc = addChild(doc, 'f1', child);

    // Moving to root: world transform becomes local
    const newLocal = computeReparentTransform(doc, 's1', null)!;
    expect(newLocal[4]).toBeCloseTo(150, EPS);
    expect(newLocal[5]).toBeCloseTo(150, EPS);
  });

  it('computeReparentPosition extracts translation', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 100, 100] }));
    const child = makeRect('s1', [1, 0, 0, 1, 50, 50]);
    doc = addChild(doc, 'f1', child);

    const pos = computeReparentPosition(doc, 's1', null)!;
    expect(pos[0]).toBeCloseTo(150, EPS);
    expect(pos[1]).toBeCloseTo(150, EPS);
  });
});

describe('CoordinateService — rotation baking', () => {
  it('bakes rotation into transform', () => {
    let doc = createDocument();
    const node = makeRect('s1', [1, 0, 0, 1, 100, 200]);
    node.rotation = 90;
    doc = addNode(doc, node);

    const baked = bakeRotationIntoTransform(doc.nodes.s1!);
    expect(baked.rotation).toBe(0);

    // Verify the baked transform produces the same world transform
    const original = nodeWorldTransform(doc, 's1');
    const bakedDoc = { ...doc, nodes: { ...doc.nodes, s1: baked } };
    const bakedWorld = nodeWorldTransform(bakedDoc, 's1');

    for (let i = 0; i < 6; i++) {
      expect(bakedWorld[i]).toBeCloseTo(original[i]!, 6);
    }
  });

  it('does not modify node with zero rotation', () => {
    const node = makeRect('s1', [1, 0, 0, 1, 100, 200]);
    node.rotation = 0;

    const baked = bakeRotationIntoTransform(node);
    expect(baked).toBe(node); // Same reference, no copy
  });

  it('migrateRotationToTransform bakes all nodes', () => {
    let doc = createDocument();
    const n1 = makeRect('s1', [1, 0, 0, 1, 100, 200]);
    n1.rotation = 45;
    const n2 = makeRect('s2', [1, 0, 0, 1, 300, 400]);
    n2.rotation = 90;
    doc = addNode(doc, n1);
    doc = addNode(doc, n2);

    const migrated = migrateRotationToTransform(doc);
    expect(migrated.nodes.s1!.rotation).toBe(0);
    expect(migrated.nodes.s2!.rotation).toBe(0);

    // Verify world transforms are preserved
    for (const id of ['s1', 's2']) {
      const original = nodeWorldTransform(doc, id);
      const migratedWorld = nodeWorldTransform(migrated, id);
      expect(migratedWorld).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        expect(migratedWorld[i]).toBeCloseTo(original[i]!, 6);
      }
    }
  });
});

describe('CoordinateService — validation', () => {
  it('passes for valid document', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 100, 200]));

    const errors = validateDocumentTransforms(doc);
    expect(errors).toHaveLength(0);
  });

  it('detects non-finite transform values', () => {
    let doc = createDocument();
    const node = makeRect('s1', [NaN, 0, 0, 1, 100, 200]);
    doc = addNode(doc, node);

    const errors = validateDocumentTransforms(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('non-finite');
  });

  it('detects zero-scale transforms', () => {
    let doc = createDocument();
    const node = makeRect('s1', [0, 0, 0, 0, 100, 200]);
    doc = addNode(doc, node);

    const errors = validateDocumentTransforms(doc);
    expect(errors.some((e) => e.includes('zero-scale'))).toBe(true);
  });
});

describe('CoordinateService — edge cases', () => {
  it('handles deeply nested transforms', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 10, 10] }));
    const g1 = makeGroupNode('g1', { transform: [1, 0, 0, 1, 20, 20] });
    doc = addChild(doc, 'f1', g1);
    const s1 = makeRect('s1', [1, 0, 0, 1, 30, 30]);
    doc = addChild(doc, 'g1', s1);

    // World position: 10 + 20 + 30 = 60
    const world = localToWorld(doc, 's1', [5, 5]);
    expect(world[0]).toBeCloseTo(65, EPS);
    expect(world[1]).toBeCloseTo(65, EPS);

    const local = worldToLocal(doc, 's1', world);
    expect(local![0]).toBeCloseTo(5, EPS);
    expect(local![1]).toBeCloseTo(5, EPS);
  });

  it('handles negative positions', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, -100, -200]));

    const world = localToWorld(doc, 's1', [10, 20]);
    expect(world[0]).toBeCloseTo(-90, EPS);
    expect(world[1]).toBeCloseTo(-180, EPS);
  });

  it('handles fractional positions', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 0.5, 0.25]));

    const world = localToWorld(doc, 's1', [0.1, 0.2]);
    expect(world[0]).toBeCloseTo(0.6, EPS);
    expect(world[1]).toBeCloseTo(0.45, EPS);
  });

  it('handles non-uniform scale', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [2, 0, 0, 3, 100, 200]));

    const world = localToWorld(doc, 's1', [10, 20]);
    expect(world[0]).toBeCloseTo(120, EPS); // 100 + 2*10
    expect(world[1]).toBeCloseTo(260, EPS); // 200 + 3*20

    const local = worldToLocal(doc, 's1', world);
    expect(local![0]).toBeCloseTo(10, EPS);
    expect(local![1]).toBeCloseTo(20, EPS);
  });

  it('handles identity transform', () => {
    let doc = createDocument();
    doc = addNode(doc, makeRect('s1', [1, 0, 0, 1, 0, 0]));

    const world = localToWorld(doc, 's1', [42, 84]);
    expect(world[0]).toBeCloseTo(42, EPS);
    expect(world[1]).toBeCloseTo(84, EPS);
  });

  it('returns identity for non-existent node', () => {
    const doc = createDocument();
    const t = nodeWorldTransform(doc, 'nonexistent');
    expect(t).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('terminates on a cyclic parent graph (no infinite loop)', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('f1', { transform: [1, 0, 0, 1, 0, 0] }));
    doc = addNode(doc, makeFrameNode('f2', { transform: [1, 0, 0, 1, 0, 0] }));
    // Manually corrupt: f1 -> f2 -> f1
    const nodes = { ...doc.nodes };
    nodes.f1 = { ...(nodes.f1 as import('./types').FrameNode), children: ['f2'] };
    nodes.f2 = { ...(nodes.f2 as import('./types').FrameNode), children: ['f1'] };
    const cyclic = { ...doc, nodes };

    const t = nodeWorldTransform(cyclic, 'f1');
    expect(t).toHaveLength(6);
    expect(t.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('returns null bounds for non-existent node', () => {
    const doc = createDocument();
    const b = nodeWorldBounds(doc, 'nonexistent');
    expect(b).toBeNull();
  });
});

describe('CoordinateService — moving a parent must not rewrite descendants', () => {
  it('moving an artboard changes child world position but not child local position', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('art', { transform: [1, 0, 0, 1, 1000, 500] }));
    const child = makeRect('child', [1, 0, 0, 1, 25, 75]);
    doc = addChild(doc, 'art', child);

    const childLocalBefore = doc.nodes.child!.transform;
    const childWorldBefore = nodeWorldTransform(doc, 'child');

    // Child world position: (1000+25, 500+75) = (1025, 575)
    expect(childWorldBefore[4]).toBeCloseTo(1025, EPS);
    expect(childWorldBefore[5]).toBeCloseTo(575, EPS);

    // Move the artboard: only the artboard transform changes.
    doc = {
      ...doc,
      nodes: { ...doc.nodes, art: { ...doc.nodes.art!, transform: [1, 0, 0, 1, 2000, -400] } },
    };

    // Stored child local coordinates unchanged.
    expect(doc.nodes.child!.transform).toBe(childLocalBefore);

    // Derived world position follows the artboard: (2025, -325).
    const childWorldAfter = nodeWorldTransform(doc, 'child');
    expect(childWorldAfter[4]).toBeCloseTo(2025, EPS);
    expect(childWorldAfter[5]).toBeCloseTo(-325, EPS);
  });

  it('world round-trip through a nested chain preserves local coordinates', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('art', { transform: [1, 0, 0, 1, 1200, 800] }));
    const g = makeGroupNode('g1', { transform: [1, 0, 0, 1, 50, 20] });
    doc = addChild(doc, 'art', g);
    const child = makeRect('s1', [1, 0, 0, 1, 40, 80]);
    doc = addChild(doc, 'g1', child);

    const world = localToWorld(doc, 's1', [10, 10]);
    expect(world[0]).toBeCloseTo(1300, EPS); // 1200 + 50 + 40 + 10
    expect(world[1]).toBeCloseTo(910, EPS); // 800 + 20 + 80 + 10

    const local = worldToLocal(doc, 's1', world);
    expect(local![0]).toBeCloseTo(10, EPS);
    expect(local![1]).toBeCloseTo(10, EPS);
  });
});
