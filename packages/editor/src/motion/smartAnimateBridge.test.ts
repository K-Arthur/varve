import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { computeSmartAnimateHotspotOverrides } from './smartAnimateBridge';

describe('computeSmartAnimateHotspotOverrides', () => {
  it('interpolates matched hotspot position between screens', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Button',
          transform: [1, 0, 0, 1, 10, 20],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Button',
          transform: [1, 0, 0, 1, 110, 220],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Button' }];
    const values = {
      Button: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 10, 20], to: [1, 0, 0, 1, 110, 220] },
      },
    };
    const getBounds = () => ({ x: 0, y: 0, w: 100, h: 50 });

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getBounds,
    );

    expect(mid.from.r1?.left).toBeGreaterThan(10);
    expect(mid.from.r1?.left).toBeLessThan(110);
    expect(mid.to.r2?.top).toBeGreaterThan(20);
    expect(mid.to.r2?.top).toBeLessThan(220);
  });
});
