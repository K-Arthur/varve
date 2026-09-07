import {
  addChild,
  addNode,
  createDocument,
  makeAdjustmentNode,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { resolveNavigationBounds } from './navigationBounds';

describe('resolveNavigationBounds', () => {
  it('uses canonical world bounds for nested content and unions multi-selection', () => {
    let doc = createDocument('navigation', true);
    const group = makeGroupNode('group', { name: 'Group', children: [] });
    const first = makeShapeNode(
      'first',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      {
        transform: [1, 0, 0, 1, 20, 30],
      },
    );
    const second = makeShapeNode(
      'second',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 50 },
      {
        transform: [1, 0, 0, 1, 300, 200],
      },
    );
    doc = addNode(doc, group);
    doc = addChild(doc, group.id, first);
    doc = addChild(doc, group.id, second);

    const result = resolveNavigationBounds(doc, [first.id, second.id]);
    expect(result.reason).toBe('resolved');
    expect(result.targetIds).toEqual([first.id, second.id]);
    expect(result.bounds).toMatchObject({ x: 20, y: 30, w: 320, h: 220 });
  });

  it('resolves adjustment rows to their affected scope instead of their own transform', () => {
    let doc = createDocument('navigation', true);
    const target = makeShapeNode(
      'target',
      { kind: 'rect', x: 0, y: 0, w: 180, h: 120 },
      {
        transform: [1, 0, 0, 1, 400, 250],
      },
    );
    const adjustment = makeAdjustmentNode(
      'adjustment',
      'curves',
      { channel: 'rgb', points: [] },
      { scope: { mode: 'explicit-targets', targetNodeIds: [target.id] } },
    );
    doc = addNode(doc, target);
    doc = addNode(doc, adjustment);

    const result = resolveNavigationBounds(doc, [adjustment.id]);
    expect(result.reason).toBe('resolved');
    expect(result.targetIds).toEqual([target.id]);
    expect(result.bounds).toMatchObject({ x: 400, y: 250, w: 180, h: 120 });
  });

  it('reports empty adjustment scopes without inventing a target rectangle', () => {
    let doc = createDocument('navigation', true);
    const adjustment = makeAdjustmentNode(
      'adjustment',
      'curves',
      { channel: 'rgb', points: [] },
      { scope: { mode: 'explicit-targets', targetNodeIds: [] } },
    );
    doc = addNode(doc, adjustment);

    expect(resolveNavigationBounds(doc, [adjustment.id])).toEqual({
      bounds: null,
      reason: 'invalid-target',
      targetIds: [],
    });
  });
});
