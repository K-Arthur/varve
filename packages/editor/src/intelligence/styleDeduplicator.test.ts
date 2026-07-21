// @ts-nocheck
import type { Document, Style } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { findDuplicateStyles } from './styleDeduplicator';

function makeDoc(styles: Record<string, Style>): Document {
  return {
    id: 'doc',
    name: 'test',
    formatVersion: '2.0',
    rootChildren: ['n1', 'n2', 'n3'],
    nodes: {
      n1: {
        id: 'n1',
        name: 'Node 1',
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } as any,
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
        strokes: [],
        effects: [],
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        order: 'a0',
        styleId: 's1',
      },
      n2: {
        id: 'n2',
        name: 'Node 2',
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } as any,
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
        strokes: [],
        effects: [],
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        order: 'a1',
        styleId: 's2',
      },
      n3: {
        id: 'n3',
        name: 'Node 3',
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } as any,
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 60, g: 60, b: 60, a: 255 },
        strokes: [],
        effects: [],
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        order: 'a2',
      },
    },
    components: {},
    nextId: 4,
    styles,
  };
}

describe('findDuplicateStyles', () => {
  it('detects duplicate color styles', () => {
    const doc = makeDoc({
      s1: {
        id: 's1',
        type: 'color',
        name: 'Teal Primary',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
      s2: {
        id: 's2',
        type: 'color',
        name: 'Also Teal',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
    });

    const suggestions = findDuplicateStyles(doc);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].sourceStyleId).toBe('s1');
    expect(suggestions[0].targetStyleId).toBe('s2');
    expect(suggestions[0].usageCount).toBe(2);
    expect(suggestions[0].canAutoMerge).toBe(true);
  });

  it('detects duplicate text styles', () => {
    const doc = makeDoc({
      s1: {
        id: 's1',
        type: 'text',
        name: 'Heading 1',
        fontSize: 24,
        fontFamily: 'Inter',
        fontWeight: 700,
      },
      s2: {
        id: 's2',
        type: 'text',
        name: 'Heading 1 Dupe',
        fontSize: 24,
        fontFamily: 'Inter',
        fontWeight: 700,
      },
    });

    const suggestions = findDuplicateStyles(doc);
    expect(suggestions).toHaveLength(1);
  });

  it('ignores distinct styles', () => {
    const doc = makeDoc({
      s1: {
        id: 's1',
        type: 'color',
        name: 'Teal',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
      s2: {
        id: 's2',
        type: 'color',
        name: 'Red',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 60, b: 60, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
    });

    const suggestions = findDuplicateStyles(doc);
    expect(suggestions).toHaveLength(0);
  });

  it('returns empty when no styles exist', () => {
    const doc = makeDoc({});
    delete doc.styles;
    expect(findDuplicateStyles(doc)).toEqual([]);
  });

  it('returns empty for single style', () => {
    const doc = makeDoc({
      s1: {
        id: 's1',
        type: 'color',
        name: 'Teal',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
    });

    expect(findDuplicateStyles(doc)).toEqual([]);
  });

  it('handles empty styles object', () => {
    const doc = makeDoc({});
    expect(findDuplicateStyles(doc)).toEqual([]);
  });

  it('is deterministic', () => {
    const doc = makeDoc({
      s1: {
        id: 's1',
        type: 'color',
        name: 'Teal',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
      s2: {
        id: 's2',
        type: 'color',
        name: 'Teal Dupe',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
    });

    const r1 = findDuplicateStyles(doc);
    const r2 = findDuplicateStyles(doc);
    expect(r1).toEqual(r2);
  });
});
