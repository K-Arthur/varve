/**
 * Tests for the flattening analysis module.
 */

import { addNode, createDocument, makeFrameNode, makeShapeNode, makeTextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import {
  analyzeFlattening,
  analyzeNodeFlattening,
  blendModeToCss,
  canEmitAsHtml,
} from '../flattening';

describe('analyzeNodeFlattening', () => {
  it('flags adjustment layers', () => {
    const doc = createDocument('Test');
    const adj = {
      id: 'adj1',
      name: 'Curve',
      kind: 'adjustment',
      adjustments: [{ kind: 'curves', visible: true, opacity: 1 }],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      visible: true,
    } as import('@strata/scene').SceneNode;
    const spec = analyzeNodeFlattening(adj, doc);
    expect(spec.mustFlatten).toBe(true);
    expect(spec.reasons).toContain('adjustment-layer');
  });

  it('does not flag basic rects', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const spec = analyzeNodeFlattening(node, doc);
    expect(spec.mustFlatten).toBe(false);
    expect(spec.reasons).toHaveLength(0);
  });

  it('flags non-rect shapes', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'circle', cx: 50, cy: 50, r: 30 }, { name: 'Circle' });
    const spec = analyzeNodeFlattening(node, doc);
    expect(spec.mustFlatten).toBe(true);
    expect(spec.reasons).toContain('non-rect-shape');
  });

  it('flags inner shadow effects', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    (node as Record<string, unknown>).effects = [
      { type: 'innerShadow', offsetX: 2, offsetY: 2, radius: 4 },
    ];
    const spec = analyzeNodeFlattening(node, doc);
    expect(spec.mustFlatten).toBe(true);
  });

  it('flags background blur', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    (node as Record<string, unknown>).effects = [{ type: 'backgroundBlur', radius: 8 }];
    const spec = analyzeNodeFlattening(node, doc);
    expect(spec.mustFlatten).toBe(true);
    expect(spec.flattensChildren).toBe(true);
  });
});

describe('analyzeFlattening', () => {
  it('analyzes multiple root nodes', () => {
    const doc = createDocument('Test');
    const n1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const n2 = makeShapeNode('n2', { kind: 'circle', cx: 50, cy: 50, r: 30 }, { name: 'Circle' });
    const result = analyzeFlattening([n1, n2], {
      ...doc,
      nodes: { n1, n2 },
      rootChildren: ['n1', 'n2'],
    });
    expect(result.totalNodes).toBe(2);
    expect(result.flattenedNodes).toBe(1);
    expect(result.nativeNodes).toBe(1);
  });
});

describe('canEmitAsHtml', () => {
  it('returns native for simple rects', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const result = canEmitAsHtml(node, doc);
    expect(result.canEmit).toBe(true);
    expect(result.emitAs).toBe('native');
  });

  it('returns image for adjustment layers', () => {
    const doc = createDocument('Test');
    const adj = {
      id: 'adj1',
      name: 'Curve',
      kind: 'adjustment',
      adjustments: [{ kind: 'curves', visible: true, opacity: 1 }],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      visible: true,
    } as import('@strata/scene').SceneNode;
    const result = canEmitAsHtml(adj, doc);
    expect(result.emitAs).toBe('image');
  });
});

describe('blendModeToCss', () => {
  it('maps multiply correctly', () => expect(blendModeToCss('multiply')).toBe('multiply'));
  it('maps screen correctly', () => expect(blendModeToCss('screen')).toBe('screen'));
  it('maps color-dodge correctly', () => expect(blendModeToCss('colorDodge')).toBe('color-dodge'));
  it('returns undefined for normal', () => expect(blendModeToCss('normal')).toBeUndefined());
  it('returns undefined for undefined', () => expect(blendModeToCss(undefined)).toBeUndefined());
});
