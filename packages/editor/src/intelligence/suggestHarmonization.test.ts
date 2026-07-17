import type { Document, NodeId } from '@strata/scene';
import { addNode, createDocument, makeShapeNode } from '@strata/scene';
import { translate } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import { suggestHarmonization } from './spacingHarmonizer';

function makeRect(
  doc: Document,
  x: number,
  y: number,
  w: number,
  h: number,
): { doc: Document; id: NodeId } {
  const shape = { kind: 'rect' as const, x: 0, y: 0, w, h };
  const id = `n_${Math.random().toString(36).slice(2, 8)}` as NodeId;
  const node = makeShapeNode(id, shape, { name: 'Rect', transform: translate(x, y) });
  return { doc: addNode(doc, node), id };
}

describe('suggestHarmonization', () => {
  it('returns null for fewer than 3 nodes', () => {
    const { doc, id } = makeRect(createDocument('test', true), 0, 0, 100, 50);
    const result = suggestHarmonization(doc, [id]);
    expect(result).toBeNull();
  });

  it('returns null for 2 nodes', () => {
    let doc = createDocument('test', true);
    const r1 = makeRect(doc, 0, 0, 100, 50);
    doc = r1.doc;
    const r2 = makeRect(doc, 120, 0, 100, 50);
    doc = r2.doc;
    expect(suggestHarmonization(doc, [r1.id, r2.id])).toBeNull();
  });

  it('detects horizontal harmonization with uneven gaps', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const x of [0, 120, 260]) {
      const r = makeRect(doc, x, 0, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = suggestHarmonization(doc, ids);
    expect(result).not.toBeNull();
    expect(result!.axis).toBe('horizontal');
    expect(result!.adjustments.length).toBeGreaterThan(0);
  });

  it('detects vertical harmonization with uneven gaps', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const y of [0, 120, 260]) {
      const r = makeRect(doc, 0, y, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = suggestHarmonization(doc, ids);
    expect(result).not.toBeNull();
    expect(result!.axis).toBe('vertical');
    expect(result!.adjustments.length).toBeGreaterThan(0);
  });

  it('uses median for dominant gap estimation', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const x of [0, 121, 261, 422]) {
      const r = makeRect(doc, x, 0, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = suggestHarmonization(doc, ids);
    expect(result).not.toBeNull();
    expect(result!.dominantGap).toBeGreaterThan(0);
  });

  it('reports per-node adjustments with deltas', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const x of [0, 120, 260]) {
      const r = makeRect(doc, x, 0, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = suggestHarmonization(doc, ids);
    expect(result).not.toBeNull();
    for (const adj of result!.adjustments) {
      expect(typeof adj.nodeId).toBe('string');
      expect(typeof adj.currentGap).toBe('number');
      expect(typeof adj.targetGap).toBe('number');
      expect(typeof adj.delta).toBe('number');
    }
  });

  it('returns null when all gaps are within 2px of median', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const x of [0, 120, 240]) {
      const r = makeRect(doc, x, 0, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = suggestHarmonization(doc, ids);
    expect(result).toBeNull();
  });

  it('handles empty node list', () => {
    const doc = createDocument('test', true);
    expect(suggestHarmonization(doc, [])).toBeNull();
  });

  it('works with 4+ siblings', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const x of [0, 120, 260, 420, 560]) {
      const r = makeRect(doc, x, 0, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = suggestHarmonization(doc, ids);
    expect(result).not.toBeNull();
    expect(result!.adjustments.length).toBeGreaterThanOrEqual(1);
  });

  it('filters overlapping nodes before analysis', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    const r1 = makeRect(doc, 0, 0, 100, 50);
    doc = r1.doc;
    ids.push(r1.id);
    const r2 = makeRect(doc, 10, 10, 50, 30);
    doc = r2.doc;
    ids.push(r2.id);
    const r3 = makeRect(doc, 140, 0, 100, 50);
    doc = r3.doc;
    ids.push(r3.id);
    const r4 = makeRect(doc, 300, 0, 100, 50);
    doc = r4.doc;
    ids.push(r4.id);
    const result = suggestHarmonization(doc, ids);
    expect(result).not.toBeNull();
    expect(result!.adjustments.length).toBeGreaterThan(0);
  });
});
