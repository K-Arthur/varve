import type { Document, NodeId } from '@strata/scene';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { translate } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import { computeLayoutScore } from './layoutScore';

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

describe('computeLayoutScore', () => {
  it('returns 100 for a single well-placed node', () => {
    const { doc, id } = makeRect(createDocument('test', true), 0, 0, 96, 48);
    const result = computeLayoutScore(doc, [id]);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it('returns 100 for perfectly grid-aligned nodes on 8px grid', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const [x, y] of [[0, 0] as const, [128, 0] as const, [256, 0] as const]) {
      const r = makeRect(doc, x as number, y as number, 96, 80);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = computeLayoutScore(doc, ids);
    expect(result.score).toBe(100);
  });

  it('penalizes nodes not aligned to 8px grid', () => {
    const { doc, id } = makeRect(createDocument('test', true), 3, 5, 100, 50);
    const result = computeLayoutScore(doc, [id]);
    expect(result.score).toBeLessThan(100);
    expect(result.issues.some((i) => i.category === 'alignment')).toBe(true);
  });

  it('detects inconsistent sibling spacing', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const x of [0, 120, 260, 400]) {
      const r = makeRect(doc, x, 0, 100, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = computeLayoutScore(doc, ids);
    expect(result.issues.some((i) => i.category === 'spacing')).toBe(true);
  });

  it('detects overlapping non-sibling nodes', () => {
    let doc = createDocument('test', true);
    const r1 = makeRect(doc, 0, 0, 100, 50);
    doc = r1.doc;
    const r2 = makeRect(doc, 10, 10, 100, 50);
    doc = r2.doc;
    const result = computeLayoutScore(doc, [r1.id, r2.id]);
    expect(result.issues.some((i) => i.category === 'overlap')).toBe(true);
  });

  it('issues info for nesting depth > 6', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    let parentId: NodeId | null = null;
    for (let i = 0; i < 8; i++) {
      const id = `deep_${i}` as NodeId;
      const node = makeFrameNode(id, {
        name: `Frame ${i}`,
        transform: translate(i * 10, i * 10),
        w: 200,
        h: 200,
      });
      if (parentId) {
        doc = addChild(doc, parentId, node);
      } else {
        doc = addNode(doc, node);
      }
      parentId = id;
      ids.push(id);
    }
    const result = computeLayoutScore(doc, ids);
    expect(result.issues.some((i) => i.category === 'nesting')).toBe(true);
  });

  it('detects size-harmony issues among siblings', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (const w of [100, 100, 150, 100]) {
      const r = makeRect(doc, ids.length * 120, 0, w, 50);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = computeLayoutScore(doc, ids);
    expect(result.issues.some((i) => i.category === 'size-harmony')).toBe(true);
  });

  it('returns 100 for empty selection', () => {
    const doc = createDocument('test', true);
    const result = computeLayoutScore(doc, []);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it('filters locked nodes from analysis', () => {
    const doc = createDocument('test', true);
    const id = 'locked_rect' as NodeId;
    const node = makeShapeNode(id, { kind: 'rect', x: 3, y: 5, w: 100, h: 50 }, { locked: true });
    const withNode = addNode(doc, node);
    const result = computeLayoutScore(withNode, [id]);
    expect(result.score).toBe(100);
  });

  it('filters hidden nodes from analysis', () => {
    const doc = createDocument('test', true);
    const id = 'hidden_rect' as NodeId;
    const node = makeShapeNode(id, { kind: 'rect', x: 3, y: 5, w: 100, h: 50 }, { visible: false });
    const withNode = addNode(doc, node);
    const result = computeLayoutScore(withNode, [id]);
    expect(result.score).toBe(100);
  });

  it('detects off-grid x position', () => {
    const { doc, id } = makeRect(createDocument('test', true), 7, 0, 100, 50);
    const result = computeLayoutScore(doc, [id]);
    expect(result.issues.some((i) => i.category === 'alignment')).toBe(true);
  });

  it('detects off-grid y position', () => {
    const { doc, id } = makeRect(createDocument('test', true), 0, 9, 100, 50);
    const result = computeLayoutScore(doc, [id]);
    expect(result.issues.some((i) => i.category === 'alignment')).toBe(true);
  });

  it('detects off-grid width', () => {
    const { doc, id } = makeRect(createDocument('test', true), 0, 0, 102, 50);
    const result = computeLayoutScore(doc, [id]);
    expect(result.issues.some((i) => i.category === 'alignment')).toBe(true);
  });

  it('detects off-grid height', () => {
    const { doc, id } = makeRect(createDocument('test', true), 0, 0, 100, 53);
    const result = computeLayoutScore(doc, [id]);
    expect(result.issues.some((i) => i.category === 'alignment')).toBe(true);
  });

  it('scores clamped to 0-100 range', () => {
    let doc = createDocument('test', true);
    const ids: NodeId[] = [];
    for (let i = 0; i < 10; i++) {
      const r = makeRect(doc, i * 3 + 1, 0, 99 + i, 49);
      doc = r.doc;
      ids.push(r.id);
    }
    const result = computeLayoutScore(doc, ids);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
