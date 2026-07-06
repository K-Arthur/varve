import type { Document } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { sceneNeedsStructuralCompositing } from './sceneCompositing';

function makeDoc(nodes: Document['nodes']): Document {
  return {
    formatVersion: '1.3',
    nodes,
    rootChildren: Object.keys(nodes),
    components: {},
  };
}

describe('sceneNeedsStructuralCompositing', () => {
  it('returns false for flat shapes only', () => {
    const doc = makeDoc({
      r1: {
        id: 'r1',
        name: 'Rect',
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        transform: [1, 0, 0, 1, 0, 0],
        strokes: [],
        effects: [],
      },
    });
    expect(sceneNeedsStructuralCompositing(doc)).toBe(false);
  });

  it('returns true when a visible mask is present', () => {
    const doc = makeDoc({
      f1: {
        id: 'f1',
        name: 'Frame',
        kind: 'frame',
        w: 200,
        h: 160,
        transform: [1, 0, 0, 1, 0, 0],
        children: [],
        strokes: [],
        effects: [],
        mask: { type: 'clip', sourceNodeId: 'm1', visible: true },
      },
    });
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for isolated groups with children', () => {
    const doc = makeDoc({
      g1: {
        id: 'g1',
        name: 'Group',
        kind: 'group',
        transform: [1, 0, 0, 1, 0, 0],
        children: ['r1'],
        strokes: [],
        effects: [],
        isolated: true,
      },
      r1: {
        id: 'r1',
        name: 'Rect',
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        transform: [1, 0, 0, 1, 10, 10],
        strokes: [],
        effects: [],
      },
    });
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for frames with children and default clipContent', () => {
    const doc = makeDoc({
      f1: {
        id: 'f1',
        name: 'Frame',
        kind: 'frame',
        w: 200,
        h: 160,
        transform: [1, 0, 0, 1, 0, 0],
        children: ['r1'],
        strokes: [],
        effects: [],
      },
      r1: {
        id: 'r1',
        name: 'Rect',
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        transform: [1, 0, 0, 1, 10, 10],
        strokes: [],
        effects: [],
      },
    });
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });
});
