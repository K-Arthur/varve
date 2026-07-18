import type { SmartAnimateLayerValues } from '@strata/prototype';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeSmartAnimateHotspotOverrides } from './smartAnimateBridge';

const getBounds = () => ({ x: 0, y: 0, w: 100, h: 50 });

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
    const values: Record<string, SmartAnimateLayerValues> = {
      Button: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 10, 20], to: [1, 0, 0, 1, 110, 220] },
      },
    };

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

  it('interpolates rotation between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Card',
          rotation: 0,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Card',
          rotation: 90,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Card' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Card: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        rotation: { from: 0, to: 90 },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getBounds,
    );
    expect(mid.from.r1?.rotation).toBe(45);
    expect(mid.to.r2?.rotation).toBe(45);
  });

  it('interpolates cornerRadius between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Pill',
          cornerRadius: 4,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Pill',
          cornerRadius: 25,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Pill' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Pill: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        cornerRadius: { from: 4, to: 25 },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getBounds,
    );
    expect(mid.from.r1?.cornerRadius).toBe(14.5);
    expect(mid.to.r2?.cornerRadius).toBe(14.5);
  });

  it('interpolates fill colour between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Dot',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Dot',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Dot' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Dot: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        fill: { from: [255, 0, 0, 255], to: [0, 0, 255, 255] },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getBounds,
    );
    // Midpoint of red→blue: expect ~128 for each channel.
    expect(mid.from.r1?.fill).toContain('rgba(');
    expect(mid.from.r1?.fill).toContain('128');
    expect(mid.to.r2?.fill).toContain('rgba(');
    expect(mid.to.r2?.fill).toContain('128');
  });

  it('interpolates strokeWidth between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Ring',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Ring',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Ring' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Ring: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        strokeWidth: { from: 1, to: 6 },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getBounds,
    );
    expect(mid.from.r1?.strokeWidth).toBe(3.5);
    expect(mid.to.r2?.strokeWidth).toBe(3.5);
  });

  it('omits fill/rotation/cornerRadius/strokeWidth when not in values', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Plain',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Plain',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Plain' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Plain: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        // No rotation, cornerRadius, fill, or strokeWidth
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getBounds,
    );
    // New properties default to 0/empty when absent.
    expect(mid.from.r1?.rotation).toBe(0);
    expect(mid.from.r1?.cornerRadius).toBe(0);
    expect(mid.from.r1?.fill).toBe('');
    expect(mid.from.r1?.strokeWidth).toBe(0);
  });
});
