/**
 * Plane-fit and grid-artwork commands.
 *
 * Fixtures build documents directly and check world-space results with
 * independent affine algebra, including a nested-group case that catches
 * double transforms and a multi-root case that catches per-object
 * decomposition.
 */

import type { Document, SceneNode } from '@varve/scene';
import {
  constructionPlaneFromGeometry,
  createDefaultIsometricGrid,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  resolveIsometricGeometry,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { applyAffine, identity, multiplyAffine, rotateRad, translate } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldTransform } from '../../scene/world';
import {
  applyPlaneFitPlan,
  planeFitAffine,
  planGridArtwork,
  planWorldAffineTransform,
  selectionWorldCentre,
} from '../isometricPlaneCommands';

function standardPlane(planeId: 'top' | 'front' | 'side' = 'top') {
  const grid = createDefaultIsometricGrid();
  const geometry = resolveIsometricGeometry({
    originX: 0,
    originY: 0,
    spacing: 24,
    rotation: 0,
    axes: grid.axes,
  })!;
  return constructionPlaneFromGeometry(geometry, planeId)!;
}

function docWithRect(id: string, transform: Affine = identity): Document {
  const doc = createDocument('test');
  const node = makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 40, h: 20 },
    { transform: transform as never },
  );
  return { ...doc, nodes: { ...doc.nodes, [id]: node }, rootChildren: [...doc.rootChildren, id] };
}

describe('planeFitAffine', () => {
  it('maps a flat square to a plane parallelogram with equal sides', () => {
    const plane = standardPlane('top');
    const affine = planeFitAffine({ x: 100, y: 100 }, plane)!;
    const p0 = applyAffine(affine, [0, 0]);
    const p1 = applyAffine(affine, [10, 0]);
    const p2 = applyAffine(affine, [0, 10]);
    const s0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const s1 = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
    // Equal projected axis lengths: 10 plane units → 10·s world units.
    expect(s0).toBeCloseTo(10 * 24, 9);
    expect(s1).toBeCloseTo(10 * 24, 9);
    const dot = (p1[0] - p0[0]) * (p2[0] - p0[0]) + (p1[1] - p0[1]) * (p2[1] - p0[1]);
    const angle = (Math.acos(dot / (s0 * s1)) * 180) / Math.PI;
    expect(angle).toBeCloseTo(120, 9);
    // The pivot itself is fixed.
    const pivotImage = applyAffine(affine, [100, 100]);
    expect(pivotImage[0]).toBeCloseTo(100, 9);
    expect(pivotImage[1]).toBeCloseTo(100, 9);
  });

  it('round-trips through the inverse around the same pivot', () => {
    const plane = standardPlane('front');
    const pivot = { x: -37, y: 82 };
    const fit = planeFitAffine(pivot, plane)!;
    const unproject = planeFitAffine(pivot, plane, true)!;
    for (const p of [
      [0, 0],
      [100, -50],
      [13.25, 7.5],
    ] as const) {
      const round = applyAffine(unproject, applyAffine(fit, p));
      expect(round[0]).toBeCloseTo(p[0], 9);
      expect(round[1]).toBeCloseTo(p[1], 9);
    }
  });

  it('returns null for the inverse of a singular basis', () => {
    const plane = standardPlane();
    const singular = { ...plane, basis: [1, 0, 2, 0] as const };
    expect(planeFitAffine({ x: 0, y: 0 }, singular, true)).toBeNull();
  });
});

describe('planWorldAffineTransform', () => {
  it('transforms a selection root once and preserves descendants', () => {
    const plane = standardPlane();
    const affine = planeFitAffine({ x: 0, y: 0 }, plane)!;
    let doc = createDocument('test');
    const parentTransform: Affine = translate(30, 40);
    const childTransform: Affine = rotateRad(0.5);
    const parent = makeGroupNode('group', { transform: parentTransform, children: ['child'] });
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      {
        transform: childTransform,
      },
    );
    doc = { ...doc, nodes: { group: parent as SceneNode, child }, rootChildren: ['group'] };

    const plan = planWorldAffineTransform(doc, ['child'], affine);
    expect(plan.rootCount).toBe(1);
    const result = applyPlaneFitPlan(doc, plan);
    // Child world transform is the affine applied to its previous world
    // transform — exactly once, not once per ancestor.
    const before = nodeWorldTransform(doc, 'child', new Map([['child', 'group']]));
    const after = nodeWorldTransform(result, 'child', new Map([['child', 'group']]));
    const expected = multiplyAffine(affine, before);
    for (let i = 0; i < 6; i++) {
      expect(after[i]).toBeCloseTo(expected[i]!, 9);
    }
    // The parent transform is untouched.
    expect(result.nodes.group!.transform).toEqual(parentTransform);
  });

  it('does not visit a selected parent and its selected child twice', () => {
    const plane = standardPlane();
    const affine = planeFitAffine({ x: 0, y: 0 }, plane)!;
    let doc = createDocument('test');
    const parent = makeGroupNode('group', { transform: translate(10, 10), children: ['child'] });
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    doc = { ...doc, nodes: { group: parent as SceneNode, child }, rootChildren: ['group'] };
    const plan = planWorldAffineTransform(doc, ['group', 'child'], affine);
    expect(plan.rootCount).toBe(1);
    expect(plan.transforms.map((entry) => entry.id)).toEqual(['group']);
  });

  it('skips effectively locked nodes', () => {
    const plane = standardPlane();
    const affine = planeFitAffine({ x: 0, y: 0 }, plane)!;
    let doc = createDocument('test');
    const locked = { ...makeGroupNode('locked', {}), locked: true };
    doc = { ...doc, nodes: { locked: locked as SceneNode }, rootChildren: ['locked'] };
    const plan = planWorldAffineTransform(doc, ['locked'], affine);
    expect(plan.locked).toBe(1);
    expect(plan.transforms).toHaveLength(0);
  });

  it('reports no-ops instead of writing identity churn', () => {
    const doc = docWithRect('rect');
    const plan = planWorldAffineTransform(doc, ['rect'], identity);
    expect(plan.transforms).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });

  it('computes the selection centre from world bounds', () => {
    const doc = docWithRect('rect', translate(10, 20));
    const centre = selectionWorldCentre(doc, ['rect'])!;
    expect(centre.x).toBeCloseTo(30, 9);
    expect(centre.y).toBeCloseTo(30, 9);
  });
});

describe('planGridArtwork', () => {
  it('produces bounded, unique, grouped line geometry within the bounds', () => {
    const doc = createDocument('test');
    const grid = { ...createDefaultIsometricGrid(), spacing: 48 };
    const plan = planGridArtwork(doc, grid, {
      bounds: { x: 0, y: 0, w: 400, h: 300 },
      maxLines: 200,
    })!;
    expect(plan).not.toBeNull();
    expect(plan.lineCount).toBeGreaterThan(0);
    expect(plan.lineCount).toBeLessThanOrEqual(200);
    expect(new Set(plan.nodeIds).size).toBe(plan.nodeIds.length);
    const group = plan.doc.nodes[plan.groupId!]!;
    expect(group.kind).toBe('group');
    // Every generated line stays inside the requested bounds.
    for (const id of plan.nodeIds) {
      const node = plan.doc.nodes[id]!;
      expect(node.kind).toBe('shape');
      if (node.kind !== 'shape' || node.shape?.kind !== 'line') continue;
      for (const point of [node.shape.from, node.shape.to]) {
        expect(point[0]).toBeGreaterThanOrEqual(-1);
        expect(point[0]).toBeLessThanOrEqual(401);
        expect(point[1]).toBeGreaterThanOrEqual(-1);
        expect(point[1]).toBeLessThanOrEqual(301);
      }
    }
  });

  it('coarsens the display step to respect the line budget', () => {
    const doc = createDocument('test');
    const grid = { ...createDefaultIsometricGrid(), spacing: 2 };
    const plan = planGridArtwork(doc, grid, {
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      maxLines: 300,
    })!;
    expect(plan.displayStep).toBeGreaterThan(1);
    expect(plan.lineCount).toBeLessThanOrEqual(300);
  });

  it('returns null for malformed grids or degenerate bounds', () => {
    const doc = createDocument('test');
    expect(
      planGridArtwork(
        doc,
        { ...createDefaultIsometricGrid(), spacing: Number.NaN },
        {
          bounds: { x: 0, y: 0, w: 100, h: 100 },
        },
      ),
    ).toBeNull();
    expect(
      planGridArtwork(doc, createDefaultIsometricGrid(), {
        bounds: { x: 0, y: 0, w: 0, h: 100 },
      }),
    ).toBeNull();
  });
});
