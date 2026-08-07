// The snap broad phase must keep seeing nodes after they move.
//
// This exercises the composition CanvasArea performs, not just the index in
// isolation: classify the edit with `computeInvalidationPlan`, apply the
// matching cache maintenance, then run the snap broad phase
// (`queryRect` -> `filterSnapTargets`) and assert the moved node is still a
// candidate.
//
// The defect this guards against was invisible at the unit level because every
// piece worked. The index was correct for the document it was built from, the
// fine phase re-read live bounds, and `snapPosition` was correct for whatever
// it received. Only the composition was wrong: `CanvasArea` cached the index
// under `doc.id`, which never changes while a document is open, so the index
// was built once per document and never refreshed. A node that moved kept its
// original cell membership, and once it left those cells the broad phase
// stopped returning it — the object silently became unsnappable.

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { computeInvalidationPlan } from '../../canvas/invalidationPlan';
import { filterSnapTargets } from '../../tools/snapping';
import { buildSpatialIndex, queryRect, updateSpatialIndexNodes } from '../spatialIndex';

function rectAt(id: string, x: number, y: number, w = 40, h = 40) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w, h },
    { name: id, transform: [1, 0, 0, 1, x, y] as Affine },
  );
}

function moveNode(doc: Document, id: string, x: number, y: number): Document {
  const node = doc.nodes[id as NodeId] as SceneNode;
  const moved = { ...node, transform: [1, 0, 0, 1, x, y] as Affine } as SceneNode;
  return { ...doc, nodes: { ...doc.nodes, [id]: moved } } as Document;
}

/** Mirror of the CanvasArea maintenance branch under test. */
function applyEdit(index: ReturnType<typeof buildSpatialIndex>, prev: Document, next: Document) {
  const plan = computeInvalidationPlan(prev, next);
  if (plan.isStructural) return { plan, index: buildSpatialIndex(next) };
  updateSpatialIndexNodes(index, next, plan.changedIds);
  return { plan, index };
}

/**
 * The snap broad phase: everything between the pointer position and
 * `snapPosition`'s candidate list.
 */
function snapCandidateCount(
  index: ReturnType<typeof buildSpatialIndex>,
  doc: Document,
  dragged: { id: string; x: number; y: number; w: number; h: number },
): number {
  const search = { x: dragged.x - 200, y: dragged.y - 200, w: dragged.w + 400, h: dragged.h + 400 };
  const nearby: Array<{ nodeId: string; bounds: { x: number; y: number; w: number; h: number } }> =
    [];
  for (const nodeId of queryRect(index, search)) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const t = node.transform as Affine;
    const shape = (node as { shape?: { w: number; h: number } }).shape;
    if (!shape) continue;
    nearby.push({ nodeId, bounds: { x: t[4]!, y: t[5]!, w: shape.w, h: shape.h } });
  }
  return filterSnapTargets(
    { x: dragged.x, y: dragged.y, w: dragged.w, h: dragged.h },
    { zoom: 1 },
    nearby,
    new Map(),
    dragged.id,
  ).length;
}

describe('snap broad phase freshness', () => {
  it('still offers a node as a snap target after it has been moved', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('target', 100, 100));
    doc = addNode(doc, rectAt('dragged', 2000, 2000));
    const index = buildSpatialIndex(doc);

    // The user moves `target` far from where it was indexed.
    const prev = doc;
    doc = moveNode(doc, 'target', 3000, 3000);
    const applied = applyEdit(index, prev, doc);

    // Now drag near the target's NEW position. Before the fix this was 0:
    // `target` was still filed under its original cells.
    const candidates = snapCandidateCount(applied.index, doc, {
      id: 'dragged',
      x: 3060,
      y: 3000,
      w: 40,
      h: 40,
    });
    expect(candidates).toBeGreaterThan(0);
  });

  it('stops offering the node at the position it vacated', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('target', 100, 100));
    doc = addNode(doc, rectAt('dragged', 2000, 2000));
    const index = buildSpatialIndex(doc);

    const prev = doc;
    doc = moveNode(doc, 'target', 3000, 3000);
    const applied = applyEdit(index, prev, doc);

    const candidates = snapCandidateCount(applied.index, doc, {
      id: 'dragged',
      x: 160,
      y: 100,
      w: 40,
      h: 40,
    });
    expect(candidates).toBe(0);
  });

  it('classifies a plain move as non-structural, so the drag path stays incremental', () => {
    // If a move were classified structural, the fix would still be correct but
    // would rebuild the whole index every pointer move — the regression this
    // asserts against.
    let doc = createDocument();
    for (let i = 0; i < 20; i++) doc = addNode(doc, rectAt(`n${i}`, i * 100, 0));
    const prev = doc;
    doc = moveNode(doc, 'n5', 640, 480);

    const plan = computeInvalidationPlan(prev, doc);
    expect(plan.isStructural).toBe(false);
    expect(plan.changedIds).toContain('n5');
  });

  it('survives a repeated drag-like sequence of moves', () => {
    let doc = createDocument();
    doc = addNode(doc, rectAt('target', 100, 100));
    doc = addNode(doc, rectAt('dragged', 5000, 5000));
    const index = buildSpatialIndex(doc);

    // 30 successive moves, as a real drag would produce.
    let current = index;
    for (let step = 1; step <= 30; step++) {
      const prev = doc;
      doc = moveNode(doc, 'target', 100 + step * 50, 100 + step * 40);
      current = applyEdit(current, prev, doc).index;
    }

    const finalX = 100 + 30 * 50;
    const finalY = 100 + 30 * 40;
    expect(
      snapCandidateCount(current, doc, {
        id: 'dragged',
        x: finalX + 60,
        y: finalY,
        w: 40,
        h: 40,
      }),
    ).toBeGreaterThan(0);
  });
});
