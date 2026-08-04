import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { suggestConstraint, suggestConstraintsForSelection } from '../constraintAdvisor';

function setUpFrameChild(
  childX: number,
  childY: number,
  childW: number,
  childH: number,
  frameW = 400,
  frameH = 300,
) {
  let doc = createDocument('Test');
  const frame = makeFrameNode('f1', { w: frameW, h: frameH, name: 'Frame', children: [] });
  doc = addNode(doc, frame);
  const child = makeShapeNode(
    'c1',
    { kind: 'rect', x: 0, y: 0, w: childW, h: childH },
    { name: 'Child', transform: [1, 0, 0, 1, childX, childY] },
  );
  doc = addChild(doc, 'f1', child);
  return { doc, frameId: 'f1', childId: 'c1' };
}

describe('suggestConstraint', () => {
  it('returns null for node without parent', () => {
    const doc = createDocument('Test');
    const suggestion = suggestConstraint(doc, 'nonexistent');
    expect(suggestion).toBeNull();
  });

  it('suggests stretch for node spanning full frame width', () => {
    const { doc, childId } = setUpFrameChild(0, 0, 400, 50);
    const suggestion = suggestConstraint(doc, childId);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.constraints.horizontal).toBe('stretch');
    expect(suggestion!.confidence).toBeGreaterThan(0);
  });

  it('suggests min for left-aligned node', () => {
    const { doc, childId } = setUpFrameChild(10, 10, 100, 50);
    const suggestion = suggestConstraint(doc, childId);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.constraints.horizontal).toBe('min');
  });

  it('suggests center for centered node', () => {
    const { doc, childId } = setUpFrameChild(150, 125, 100, 50);
    const suggestion = suggestConstraint(doc, childId);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.constraints.horizontal).toBe('center');
    expect(suggestion!.constraints.vertical).toBe('center');
  });

  it('suggests max for right-aligned node', () => {
    const { doc, childId } = setUpFrameChild(298, 10, 100, 50);
    const suggestion = suggestConstraint(doc, childId);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.constraints.horizontal).toBe('max');
  });

  it('returns null for node without frame parent (root level)', () => {
    const doc = createDocument('Test');
    const suggestion = suggestConstraint(doc, doc.rootChildren[0] ?? '');
    expect(suggestion).toBeNull();
  });
});

describe('suggestConstraintsForSelection', () => {
  it('returns suggestions for multiple nodes', () => {
    let doc = createDocument('Test');
    const frame = makeFrameNode('f1', { w: 400, h: 300, name: 'Frame', children: [] });
    doc = addNode(doc, frame);
    const c1 = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'C1', transform: [1, 0, 0, 1, 0, 0] },
    );
    doc = addChild(doc, 'f1', c1);
    const c2 = makeShapeNode(
      'c2',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'C2', transform: [1, 0, 0, 1, 300, 0] },
    );
    doc = addChild(doc, 'f1', c2);

    const suggestions = suggestConstraintsForSelection(doc, ['c1', 'c2']);
    expect(suggestions).toHaveLength(2);
  });

  it('returns empty array for empty selection', () => {
    const doc = createDocument('Test');
    const suggestions = suggestConstraintsForSelection(doc, []);
    expect(suggestions).toEqual([]);
  });
});
