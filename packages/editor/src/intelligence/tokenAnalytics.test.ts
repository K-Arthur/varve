import type { Document, FrameNode, ShapeNode, TextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeTokenCoverage } from './tokenAnalytics';

function makeShapeNode(id: string, r: number, g: number, b: number): ShapeNode {
  return {
    id,
    name: `Shape ${id}`,
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } as any,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r, g, b, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
  };
}

function makeTextNode(id: string, fontSize: number): TextNode {
  return {
    id,
    name: `Text ${id}`,
    kind: 'text',
    text: 'Hello',
    transform: [1, 0, 0, 1, 0, 0],
    fontSize,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
  };
}

function makeFrameNode(id: string, gap?: number): FrameNode {
  return {
    id,
    name: `Frame ${id}`,
    kind: 'frame',
    transform: [1, 0, 0, 1, 0, 0],
    w: 300,
    h: 200,
    children: [],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    ...(gap !== undefined
      ? {
          layoutStyle: {
            mode: 'flex' as const,
            direction: 'row' as const,
            gap,
            padding: [0, 0, 0, 0] as [number, number, number, number],
            wrap: false,
            grow: 0,
            shrink: 0,
          },
        }
      : {}),
  };
}

describe('computeTokenCoverage', () => {
  it('reports full coverage when all nodes use tokens', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['n1'],
      nodes: {
        n1: makeTextNode('n1', 16),
      },
      components: {},
      nextId: 2,
      swatches: [{ id: 'sw1', name: 'Black', color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } }],
    };

    const report = computeTokenCoverage(doc);
    expect(report.totalNodes).toBe(1);
    expect(report.tokenizedNodes).toBe(1);
    expect(report.byCategory.fonts).toBe(1);
  });

  it('reports zero coverage for empty document', () => {
    const doc: Document = {
      id: 'doc',
      name: 'empty',
      formatVersion: '2.0',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };

    const report = computeTokenCoverage(doc);
    expect(report.totalNodes).toBe(0);
    expect(report.tokenizedNodes).toBe(0);
    expect(report.overall).toBe(0);
  });

  it('detects swatch-matched colors', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['n1', 'n2'],
      nodes: {
        n1: makeShapeNode('n1', 57, 208, 198),
        n2: makeShapeNode('n2', 200, 200, 200),
      },
      components: {},
      nextId: 3,
      swatches: [
        { id: 'sw1', name: 'Teal', color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      ],
    };

    const report = computeTokenCoverage(doc);
    expect(report.byCategory.colors).toBe(0.5);
  });

  it('detects type-scaled fonts', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['n1', 'n2'],
      nodes: {
        n1: makeTextNode('n1', 24),
        n2: makeTextNode('n2', 13),
      },
      components: {},
      nextId: 3,
    };

    const report = computeTokenCoverage(doc);
    expect(report.byCategory.fonts).toBe(0.5);
  });

  it('detects token spacing on frames', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['n1', 'n2'],
      nodes: {
        n1: makeFrameNode('n1', 8),
        n2: makeFrameNode('n2'),
      },
      components: {},
      nextId: 3,
    };

    const report = computeTokenCoverage(doc);
    // n1 has gap 8 (multiple of 4) with layoutStyle → tokenized
    // n2 has no layoutStyle → not counted in spacing denominator
    expect(report.byCategory.spacing).toBe(1);
  });

  it('computes overall ratio correctly', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['n1', 'n2', 'n3'],
      nodes: {
        n1: makeTextNode('n1', 16),
        n2: makeShapeNode('n2', 57, 208, 198),
        n3: makeShapeNode('n3', 100, 100, 100),
      },
      components: {},
      nextId: 4,
      swatches: [
        { id: 'sw1', name: 'Teal', color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      ],
    };

    const report = computeTokenCoverage(doc);
    // n1: font tokenized, n2: color tokenized, n3: nothing
    // tokenizedNodes = 2, totalNodes = 3
    expect(report.tokenizedNodes).toBe(2);
    expect(report.totalNodes).toBe(3);
    expect(report.overall).toBe(2 / 3);
  });

  it('is deterministic', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['n1'],
      nodes: {
        n1: makeTextNode('n1', 16),
      },
      components: {},
      nextId: 2,
      swatches: [{ id: 'sw1', name: 'Black', color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } }],
    };

    const r1 = computeTokenCoverage(doc);
    const r2 = computeTokenCoverage(doc);
    expect(r1).toEqual(r2);
  });
});
