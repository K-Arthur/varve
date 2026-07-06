import {
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { sceneNeedsStructuralCompositing } from './sceneCompositing';

describe('sceneNeedsStructuralCompositing', () => {
  it('returns false for flat shapes only', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { name: 'Rect' }),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(false);
  });

  it('returns true when a visible mask is present', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      makeFrameNode('f1', {
        name: 'Frame',
        w: 200,
        h: 160,
      }),
    );
    doc.nodes.f1 = {
      ...(doc.nodes.f1 as import('@strata/scene').FrameNode),
      mask: { type: 'clip', sourceNodeId: 'm1', visible: true },
    };
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for isolated groups with children', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeGroupNode('g1', { name: 'Group', children: ['r1'], isolated: true }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect', transform: [1, 0, 0, 1, 10, 10] },
      ),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for frames with children and default clipContent', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeFrameNode('f1', { name: 'Frame', w: 200, h: 160, children: ['r1'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect', transform: [1, 0, 0, 1, 10, 10] },
      ),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });
});
