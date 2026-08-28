// @ts-nocheck

import type { Document, SceneNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assessNodeCapability,
  CAPABILITY,
  composeFlattenedExportSnapshot,
  findFlattenBoundaries,
} from './compositor';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoc(nodes: Record<string, SceneNode>, rootChildren: string[] = []): Document {
  return {
    id: 'test-doc',
    name: 'Test',
    formatVersion: '2.6',
    rootChildren: rootChildren.length > 0 ? rootChildren : Object.keys(nodes),
    nodes,
    components: {},
    nextId: 1,
  } as unknown as Document;
}

function makeShapeNode(
  id: string,
  shape: { kind: string; [key: string]: unknown },
  overrides?: Partial<SceneNode>,
): SceneNode {
  // Ensure shape has proper dimensions for bounds computation
  const fullShape =
    shape.kind === 'rect'
      ? { x: 0, y: 0, w: 100, h: 80, ...shape }
      : shape.kind === 'ellipse'
        ? { cx: 50, cy: 40, rx: 50, ry: 40, ...shape }
        : shape.kind === 'circle'
          ? { cx: 50, cy: 50, r: 50, ...shape }
          : shape.kind === 'line' || shape.kind === 'arrow'
            ? {
                from: [0, 0] as [number, number],
                to: [100, 80] as [number, number],
                tolerance: 2,
                ...shape,
              }
            : shape.kind === 'polygon'
              ? { cx: 50, cy: 50, radius: 50, sides: 6, rotation: 0, ...shape }
              : shape.kind === 'star'
                ? {
                    cx: 50,
                    cy: 50,
                    innerRadius: 25,
                    outerRadius: 50,
                    points: 5,
                    rotation: 0,
                    ...shape,
                  }
                : shape.kind === 'path'
                  ? {
                      points: [
                        { x: 0, y: 0 },
                        { x: 100, y: 80 },
                      ],
                      closed: false,
                      tolerance: 2,
                      ...shape,
                    }
                  : shape;
  return {
    id,
    name: `Shape ${id}`,
    kind: 'shape',
    shape: fullShape as any,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    order: 'a0',
    ...overrides,
  } as unknown as SceneNode;
}

function makeTextNode(id: string, overrides?: Partial<SceneNode>): SceneNode {
  return {
    id,
    name: `Text ${id}`,
    kind: 'text',
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    order: 'a0',
    fontSize: 16,
    fontFamily: 'sans-serif',
    text: 'Hello',
    ...overrides,
  } as unknown as SceneNode;
}

function _makeFrameNode(id: string, children: string[], overrides?: Partial<SceneNode>): SceneNode {
  return {
    id,
    name: `Frame ${id}`,
    kind: 'frame',
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    order: 'a0',
    w: 400,
    h: 300,
    children,
    ...overrides,
  } as unknown as SceneNode;
}

function makeGroupNode(id: string, children: string[], overrides?: Partial<SceneNode>): SceneNode {
  return {
    id,
    name: `Group ${id}`,
    kind: 'group',
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    order: 'a0',
    children,
    ...overrides,
  } as unknown as SceneNode;
}

function makeAdjustmentNode(id: string, overrides?: Partial<SceneNode>): SceneNode {
  return {
    id,
    name: `Adjustment ${id}`,
    kind: 'adjustment',
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    order: 'a0',
    adjustmentType: 'curves',
    params: {
      channel: 'rgb',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    clipping: false,
    adjustments: [],
    ...overrides,
  } as unknown as SceneNode;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('assessNodeCapability', () => {
  describe('shape kinds per exporter', () => {
    const shapeKinds = ['rect', 'ellipse', 'circle', 'line', 'arrow', 'polygon', 'star', 'path'];

    it.each(shapeKinds)('SVG supports shape %s', (kind) => {
      const node = makeShapeNode('s1', { kind });
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
    });

    it.each(shapeKinds)('PDF supports shape %s', (kind) => {
      const node = makeShapeNode('s1', { kind });
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(true);
    });

    it.each(shapeKinds)('Raster supports shape %s', (kind) => {
      const node = makeShapeNode('s1', { kind });
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'raster')).toBe(true);
    });
  });

  describe('effects', () => {
    it('rasterizes effect-local masks for vector and PDF exports', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          effects: [
            {
              id: 'fx-s1-1',
              type: 'dropShadow',
              visible: true,
              x: 2,
              y: 2,
              blur: 4,
              spread: 0,
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
              opacity: 0.5,
              blendMode: 'normal',
              mask: {
                source: { kind: 'scene-node', nodeId: 'matte' },
                type: 'alpha',
                coordinateSpace: 'world',
              },
            },
          ] as any,
        },
      );
      const matte = makeShapeNode('matte', { kind: 'rect' });
      const doc = makeDoc({ s1: node, matte });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
      expect(assessNodeCapability(node, doc, 'raster')).toBe(true);
    });

    it('SVG rejects nodes with dropShadow', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          effects: [
            {
              type: 'dropShadow',
              visible: true,
              x: 2,
              y: 2,
              blur: 4,
              spread: 0,
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
              opacity: 0.5,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('PDF rasterizes dropShadow because the native writer cannot preserve blur and alpha', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          effects: [
            {
              type: 'dropShadow',
              visible: true,
              x: 2,
              y: 2,
              blur: 4,
              spread: 0,
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
              opacity: 0.5,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });

    it('PDF rejects nodes with innerShadow', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          effects: [
            {
              type: 'innerShadow',
              visible: true,
              x: 0,
              y: 0,
              blur: 4,
              spread: 0,
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
              opacity: 0.5,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });

    it('PDF rejects nodes with layerBlur', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          effects: [{ type: 'layerBlur', visible: true, radius: 10 }] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });

    it('Raster supports all effect types', () => {
      const effectTypes = [
        'dropShadow',
        'innerShadow',
        'layerBlur',
        'backgroundBlur',
        'outerGlow',
        'innerGlow',
        'glassMaterial',
        'chromaticAberration',
        'glitch',
      ];
      for (const type of effectTypes) {
        const node = makeShapeNode(
          's1',
          { kind: 'rect' },
          {
            effects: [{ type, visible: true }] as any,
          },
        );
        const doc = makeDoc({ s1: node });
        expect(assessNodeCapability(node, doc, 'raster')).toBe(true);
      }
    });
  });

  it('rasterizes visible Object Filters for SVG/PDF but keeps raster native', () => {
    const node = makeShapeNode(
      'filtered',
      { kind: 'rect' },
      {
        smartFilters: [
          {
            id: 'invert',
            kind: 'invert',
            value: 100,
            visible: true,
            opacity: 1,
            blendMode: 'normal',
          },
        ] as any,
      },
    );
    const doc = makeDoc({ filtered: node });
    expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    expect(assessNodeCapability(node, doc, 'raster')).toBe(true);
  });

  describe('gradients', () => {
    it('SVG supports linear gradients', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            {
              type: 'gradient',
              visible: true,
              gradient: { type: 'linear', stops: [] },
              opacity: 1,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
    });

    it('SVG supports affine radial gradients', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            {
              type: 'gradient',
              visible: true,
              gradient: { type: 'radial', stops: [] },
              opacity: 1,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
    });

    it('SVG rasterizes shapes with multiple visible strokes', () => {
      const node = makeShapeNode(
        'multi-stroke',
        { kind: 'rect' },
        {
          strokes: [
            { color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 }, weight: 2, visible: true },
            { color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 }, weight: 6, visible: true },
          ] as any,
        },
      );
      expect(assessNodeCapability(node, makeDoc({ [node.id]: node }), 'svg')).toBe(false);
    });

    it('PDF rasterizes radial gradients while retaining affine linear gradients natively', () => {
      const radial = makeShapeNode('pdf-radial', { kind: 'rect' });
      (radial as unknown as Record<string, unknown>).fills = [
        {
          type: 'gradient',
          visible: true,
          gradient: { type: 'radial', transform: [120, 0, 0, 40, 12, 8], stops: [] },
          opacity: 1,
          blendMode: 'normal',
        },
      ];
      const linear = makeShapeNode('pdf-linear', { kind: 'rect' });
      (linear as unknown as Record<string, unknown>).fills = [
        {
          type: 'gradient',
          visible: true,
          gradient: { type: 'linear', transform: [120, 20, -10, 60, 12, 8], stops: [] },
          opacity: 1,
          blendMode: 'normal',
        },
      ];
      expect(assessNodeCapability(radial, makeDoc({ [radial.id]: radial }), 'pdf')).toBe(false);
      expect(assessNodeCapability(linear, makeDoc({ [linear.id]: linear }), 'pdf')).toBe(true);
    });

    it('SVG rejects angular gradients', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            {
              type: 'gradient',
              visible: true,
              gradient: { type: 'angular', stops: [] },
              opacity: 1,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('SVG rejects diamond gradients', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            {
              type: 'gradient',
              visible: true,
              gradient: { type: 'diamond', stops: [] },
              opacity: 1,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('keeps linear gradient strokes native in SVG and rasterizes them for PDF', () => {
      const strokeGradient = {
        type: 'gradient' as const,
        gradient: {
          type: 'linear' as const,
          stops: [
            { position: 0, color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
          ],
          transform: [120, 30, -20, 60, 4, 8] as const,
        },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      };
      const node = makeShapeNode(
        'stroke-gradient',
        { kind: 'rect' },
        {
          strokes: [
            {
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
              weight: 4,
              align: 'center',
              dashPattern: [],
              dashOffset: 0,
              cap: 'round',
              join: 'miter',
              miterLimit: 4,
              visible: true,
              gradient: strokeGradient.gradient,
            },
          ],
        },
      );
      const doc = makeDoc({ [node.id]: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
      expect(assessNodeCapability(node, doc, 'raster')).toBe(true);
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });
  });

  describe('stacked fills', () => {
    it('SVG rejects stacked fills', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            { type: 'solid', visible: true, opacity: 1, blendMode: 'normal' },
            { type: 'solid', visible: true, opacity: 1, blendMode: 'normal' },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('PDF supports stacked fills', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            { type: 'solid', visible: true, opacity: 1, blendMode: 'normal' },
            { type: 'solid', visible: true, opacity: 1, blendMode: 'normal' },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(true);
    });
  });

  describe('pattern fills', () => {
    it('SVG rejects pattern fills', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            {
              type: 'pattern',
              visible: true,
              pattern: { tileSrc: 'tile.png', spacing: 10, rotation: 0 },
              opacity: 1,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('PDF supports pattern fills', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          fills: [
            {
              type: 'pattern',
              visible: true,
              pattern: { tileSrc: 'tile.png', spacing: 10, rotation: 0 },
              opacity: 1,
              blendMode: 'normal',
            },
          ] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(true);
    });
  });

  describe('adjustment nodes', () => {
    it('SVG rejects adjustment nodes', () => {
      const node = makeAdjustmentNode('a1');
      const doc = makeDoc({ a1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('PDF rejects adjustment nodes', () => {
      const node = makeAdjustmentNode('a1');
      const doc = makeDoc({ a1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });

    it('Raster supports adjustment nodes', () => {
      const node = makeAdjustmentNode('a1');
      const doc = makeDoc({ a1: node });
      expect(assessNodeCapability(node, doc, 'raster')).toBe(true);
    });
  });

  describe('text nodes', () => {
    it('SVG supports text', () => {
      const node = makeTextNode('t1');
      const doc = makeDoc({ t1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
    });

    it('PDF supports text via strata-print', () => {
      const node = makeTextNode('t1');
      const doc = makeDoc({ t1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(true);
    });

    it('PDF rasterizes text on path at the affected node boundary', () => {
      const node = makeTextNode('t1', {
        textMode: 'path',
        pathTextSettings: { pathNodeId: 'path-1', startOffset: 0.25 },
      });
      const doc = makeDoc({ t1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });
  });

  describe('transforms', () => {
    it('PDF rejects rotated content', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          transform: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0] as any, // 45-degree rotation
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'pdf')).toBe(false);
    });

    it('SVG supports rotated content', () => {
      const node = makeShapeNode(
        's1',
        { kind: 'rect' },
        {
          transform: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0] as any,
        },
      );
      const doc = makeDoc({ s1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
    });
  });

  describe('blend modes', () => {
    it('SVG rejects group with effects and non-normal blend', () => {
      const node = makeGroupNode('g1', [], {
        blendMode: 'multiply' as any,
        effects: [{ type: 'layerBlur', visible: true, radius: 5 }] as any,
      });
      const doc = makeDoc({ g1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(false);
    });

    it('SVG accepts group with non-normal blend but no effects', () => {
      const node = makeGroupNode('g1', [], {
        blendMode: 'multiply' as any,
      });
      const doc = makeDoc({ g1: node });
      expect(assessNodeCapability(node, doc, 'svg')).toBe(true);
    });
  });
});

describe('findFlattenBoundaries', () => {
  it('returns empty for raster target', () => {
    const node = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: node });
    const boundaries = findFlattenBoundaries([node], doc, 'raster');
    expect(boundaries).toHaveLength(0);
  });

  it('identifies leaf unsupported nodes', () => {
    const node = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: node });
    const boundaries = findFlattenBoundaries([node], doc, 'svg');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].nodeId).toBe('s1');
    expect(boundaries[0].boundary).toBe('node');
  });

  it('creates a PDF raster boundary for a drop shadow instead of using the lossy native path', () => {
    const node = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [
          {
            type: 'dropShadow',
            visible: true,
            x: 4,
            y: 6,
            blur: 12,
            spread: 3,
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
            opacity: 0.5,
            blendMode: 'multiply',
          },
        ],
      },
    );
    const doc = makeDoc({ s1: node });

    const boundaries = findFlattenBoundaries([node], doc, 'pdf');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ nodeId: 's1', boundary: 'node' });
  });

  it('identifies nested unsupported children individually', () => {
    const s1 = makeShapeNode('s1', { kind: 'rect' });
    const s2 = makeShapeNode(
      's2',
      { kind: 'circle' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const g1 = makeGroupNode('g1', ['s1', 's2']);
    const doc = makeDoc({ s1, s2, g1 });

    const boundaries = findFlattenBoundaries([g1], doc, 'svg');
    // s1 is supported (no effects), s2 is unsupported — should rasterize s2
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].nodeId).toBe('s2');
    expect(boundaries[0].boundary).toBe('node');
  });

  it('rasterizes whole group when all children unsupported', () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const s2 = makeShapeNode(
      's2',
      { kind: 'circle' },
      {
        effects: [{ type: 'layerBlur', visible: true, radius: 5 }] as any,
      },
    );
    const g1 = makeGroupNode('g1', ['s1', 's2']);
    const doc = makeDoc({ s1, s2, g1 });

    const boundaries = findFlattenBoundaries([g1], doc, 'svg');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].nodeId).toBe('g1');
    expect(boundaries[0].boundary).toBe('group');
  });

  it('rasterizes at group boundary for nested unsupported in mixed container', () => {
    const s1 = makeShapeNode('s1', { kind: 'rect' });
    const inner = makeGroupNode('inner', ['s1'], {
      effects: [{ type: 'dropShadow', visible: true }] as any,
    });
    const s2 = makeShapeNode('s2', { kind: 'circle' });
    const outer = makeGroupNode('outer', ['inner', 's2']);
    const doc = makeDoc({ s1, inner, s2, outer });

    const boundaries = findFlattenBoundaries([outer], doc, 'svg');
    // inner has effects — needs rasterization; s1 and s2 are fine
    expect(boundaries.some((b) => b.nodeId === 'inner')).toBe(true);
  });

  it('handles empty document', () => {
    const doc = makeDoc({});
    const boundaries = findFlattenBoundaries([], doc, 'svg');
    expect(boundaries).toHaveLength(0);
  });

  it('handles invisible nodes', () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        visible: false,
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1 });
    const boundaries = findFlattenBoundaries([s1], doc, 'svg');
    expect(boundaries).toHaveLength(0); // invisible nodes filtered out
  });
});

describe('composeFlattenedExportSnapshot', () => {
  beforeEach(() => {
    // Mock createRasterSurface and encodeRasterSurface
    vi.mock('@varve/engine', async () => {
      const actual = await vi.importActual('@varve/engine');
      return {
        ...actual,
        createRasterSurface: vi.fn(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 100;
          return {
            canvas,
            context: canvas.getContext('2d'),
            backend: 'html' as const,
          };
        }),
        encodeRasterSurface: vi.fn(async () => {
          return new Blob(['fake-png-data'], { type: 'image/png' });
        }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces raster assets for unsupported nodes', async () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: s1 });

    const result = await composeFlattenedExportSnapshot(doc, ['svg'], {
      scale: 1,
      dpi: 96,
    });

    expect(result.svg.rasterAssets.s1).toBeDefined();
    expect(result.svg.rasterAssets.s1.nodeId).toBe('s1');
    expect(result.svg.rasterizedNodeIds.has('s1')).toBe(true);
  });

  it('preserves supported nodes in output', async () => {
    const s1 = makeShapeNode('s1', { kind: 'rect' });
    const doc = makeDoc({ s1: s1 });

    const result = await composeFlattenedExportSnapshot(doc, ['svg'], {
      scale: 1,
      dpi: 96,
    });

    expect(result.svg.supportedNodeIds.has('s1')).toBe(true);
    expect(result.svg.rasterAssets.s1).toBeUndefined();
  });

  it('clean export (all supported) produces no raster assets', async () => {
    const s1 = makeShapeNode('s1', { kind: 'rect' });
    const s2 = makeShapeNode('s2', { kind: 'circle' });
    const doc = makeDoc({ s1, s2 });

    const result = await composeFlattenedExportSnapshot(doc, ['svg', 'pdf'], {
      scale: 1,
      dpi: 96,
    });

    expect(Object.keys(result.svg.rasterAssets)).toHaveLength(0);
    expect(Object.keys(result.pdf.rasterAssets)).toHaveLength(0);
  });

  it('raster assets have correct pixel dimensions', async () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: s1 });

    const result = await composeFlattenedExportSnapshot(doc, ['svg'], {
      scale: 2,
      dpi: 96,
    });

    const asset = result.svg.rasterAssets.s1;
    expect(asset).toBeDefined();
    expect(asset.pixelWidth).toBeGreaterThan(0);
    expect(asset.pixelHeight).toBeGreaterThan(0);
  });

  it('returns results for all requested targets', async () => {
    const s1 = makeShapeNode('s1', { kind: 'rect' });
    const doc = makeDoc({ s1: s1 });

    const result = await composeFlattenedExportSnapshot(doc, ['svg', 'pdf'], {
      scale: 1,
      dpi: 96,
    });

    expect(result.svg).toBeDefined();
    expect(result.pdf).toBeDefined();
  });
});

describe('cancellation', () => {
  it('throws AbortError when signal is aborted', async () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: s1 });
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    await expect(
      composeFlattenedExportSnapshot(doc, ['svg'], {
        scale: 1,
        dpi: 96,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Export cancelled');
  });

  it('throws AbortError mid-export', async () => {
    const nodes: Record<string, SceneNode> = {};
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `s${i}`;
      ids.push(id);
      nodes[id] = makeShapeNode(
        id,
        { kind: 'rect' },
        {
          effects: [{ type: 'dropShadow', visible: true }] as any,
        },
      );
    }
    const doc = makeDoc(nodes, ids);
    const controller = new AbortController();

    // Abort after a short delay
    setTimeout(() => controller.abort(), 5);

    await expect(
      composeFlattenedExportSnapshot(doc, ['svg'], {
        scale: 1,
        dpi: 96,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Export cancelled');
  });
});

describe('progress callback', () => {
  it('reports progress during export', async () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: s1 });
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    await composeFlattenedExportSnapshot(doc, ['svg'], {
      scale: 1,
      dpi: 96,
      onProgress: (phase, current, total) => {
        progressCalls.push({ phase, current, total });
      },
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1].phase).toBe('complete');
  });
});

describe('capability table completeness', () => {
  it('has entries for all export targets', () => {
    expect(CAPABILITY.svg).toBeDefined();
    expect(CAPABILITY.pdf).toBeDefined();
    expect(CAPABILITY.raster).toBeDefined();
  });

  it('raster supports all shape kinds', () => {
    const allKinds = ['rect', 'ellipse', 'circle', 'line', 'arrow', 'polygon', 'star', 'path'];
    for (const kind of allKinds) {
      expect(CAPABILITY.raster.nativeShapeKinds.has(kind)).toBe(true);
    }
  });

  it('raster supports all gradient types', () => {
    const allTypes = ['linear', 'radial', 'angular', 'diamond'];
    for (const type of allTypes) {
      expect(CAPABILITY.raster.nativeGradientTypes.has(type)).toBe(true);
    }
  });

  it('raster supports all effect types', () => {
    const allEffects = [
      'dropShadow',
      'innerShadow',
      'layerBlur',
      'backgroundBlur',
      'outerGlow',
      'innerGlow',
      'glassMaterial',
      'chromaticAberration',
      'glitch',
    ];
    for (const type of allEffects) {
      expect(CAPABILITY.raster.nativeEffectTypes.has(type)).toBe(true);
    }
  });

  it('SVG supports affine linear and radial gradients', () => {
    expect(CAPABILITY.svg.nativeGradientTypes.has('linear')).toBe(true);
    expect(CAPABILITY.svg.nativeGradientTypes.has('radial')).toBe(true);
    expect(CAPABILITY.svg.nativeGradientTypes.has('angular')).toBe(false);
    expect(CAPABILITY.svg.nativeGradientTypes.has('diamond')).toBe(false);
  });

  it('PDF rasterizes every effect that the native writer cannot reproduce faithfully', () => {
    expect(CAPABILITY.pdf.nativeEffectTypes.has('dropShadow')).toBe(false);
    expect(CAPABILITY.pdf.nativeEffectTypes.has('innerShadow')).toBe(false);
    expect(CAPABILITY.pdf.nativeEffectTypes.has('layerBlur')).toBe(false);
  });
});

describe('determinism', () => {
  it('same input produces same output', async () => {
    const s1 = makeShapeNode(
      's1',
      { kind: 'rect' },
      {
        effects: [{ type: 'dropShadow', visible: true }] as any,
      },
    );
    const doc = makeDoc({ s1: s1 });

    const result1 = await composeFlattenedExportSnapshot(doc, ['svg'], { scale: 1 });
    const result2 = await composeFlattenedExportSnapshot(doc, ['svg'], { scale: 1 });

    expect(result1.svg.rasterizedNodeIds).toEqual(result2.svg.rasterizedNodeIds);
    expect(result1.svg.supportedNodeIds).toEqual(result2.svg.supportedNodeIds);
    expect(Object.keys(result1.svg.rasterAssets)).toEqual(Object.keys(result2.svg.rasterAssets));
  });
});
