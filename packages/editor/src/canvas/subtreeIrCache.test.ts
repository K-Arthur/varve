import type { SceneNode as EngineNode, RenderItem, Stroke } from '@strata/engine';
import { describe, expect, it } from 'vitest';
import { cacheContentParts, SubtreeIrCache } from './subtreeIrCache';

function makeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    weight: 1,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'butt',
    join: 'miter',
    miterLimit: 4,
    visible: true,
    ...overrides,
  };
}

function makeNode(overrides: Partial<EngineNode> = {}): EngineNode {
  return {
    id: 'n1',
    name: 'Node',
    transform: [1, 0, 0, 1, 0, 0],
    ...overrides,
  };
}

describe('SubtreeIrCache', () => {
  it('returns cached item when hash matches', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    const hash = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], '');
    cache.set('n1', hash, item);
    expect(cache.get('n1', hash)).toEqual(item);
  });

  it('misses when hash changes', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    cache.set('n1', 'hash-a', item);
    expect(cache.get('n1', 'hash-b')).toBeNull();
  });

  it('invalidates all entries', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    cache.set('n1', 'h', item);
    cache.invalidate();
    expect(cache.get('n1', 'h')).toBeNull();
  });

  describe('nodeHash', () => {
    it('is stable for identical content across separate calls', () => {
      // CanvasArea.tsx computes a fresh hash on every draw pass and looks it
      // up against the previous pass's stored hash — an unrelated node's
      // hash must stay IDENTICAL across two edits elsewhere in the document
      // for that node's cache entry to ever be reused. Regression coverage
      // for a bug where a global, ever-incrementing docVersion was mixed
      // into every node's hash, so any edit anywhere invalidated every
      // other node's entry too, defeating selective invalidation entirely.
      const a = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 5, 5], 'style-a', ['rect', '10', '10']);
      const b = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 5, 5], 'style-a', ['rect', '10', '10']);
      expect(a).toBe(b);
    });

    it('changes when transform, styleKey, or content parts differ', () => {
      const base = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-a', ['rect']);
      const movedTransform = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 9, 0], 'style-a', ['rect']);
      const differentStyle = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-b', ['rect']);
      const differentContent = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-a', [
        'ellipse',
      ]);
      expect(movedTransform).not.toBe(base);
      expect(differentStyle).not.toBe(base);
      expect(differentContent).not.toBe(base);
    });
  });

  describe('cacheContentParts', () => {
    // A length-only signal (the pre-fix behavior) can't see any of these —
    // it's the same array length before and after, so a stale cached IR
    // item would keep being served after the user's edit.
    it('changes when stroke weight changes (not just stroke count)', () => {
      const before = cacheContentParts(makeNode({ strokes: [makeStroke({ weight: 1 })] }));
      const after = cacheContentParts(makeNode({ strokes: [makeStroke({ weight: 5 })] }));
      expect(before).not.toEqual(after);
    });

    it('changes when stroke align/dash/cap/join change', () => {
      const base = cacheContentParts(makeNode({ strokes: [makeStroke()] }));
      expect(
        cacheContentParts(makeNode({ strokes: [makeStroke({ align: 'inside' })] })),
      ).not.toEqual(base);
      expect(
        cacheContentParts(makeNode({ strokes: [makeStroke({ dashPattern: [4, 2] })] })),
      ).not.toEqual(base);
      expect(cacheContentParts(makeNode({ strokes: [makeStroke({ cap: 'round' })] }))).not.toEqual(
        base,
      );
      expect(cacheContentParts(makeNode({ strokes: [makeStroke({ join: 'round' })] }))).not.toEqual(
        base,
      );
    });

    it('changes when a fill or effect toggles visibility', () => {
      const fill: NonNullable<EngineNode['fills']>[number] = {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      const visible = cacheContentParts(makeNode({ fills: [fill] }));
      const hidden = cacheContentParts(makeNode({ fills: [{ ...fill, visible: false }] }));
      expect(visible).not.toEqual(hidden);

      const effect: NonNullable<EngineNode['effects']>[number] = {
        type: 'layerBlur',
        radius: 4,
        visible: true,
      };
      const effectVisible = cacheContentParts(makeNode({ effects: [effect] }));
      const effectHidden = cacheContentParts(
        makeNode({ effects: [{ ...effect, visible: false }] }),
      );
      expect(effectVisible).not.toEqual(effectHidden);
    });

    it('changes when text font properties change, and distinguishes equal-length text', () => {
      const base = cacheContentParts(
        makeNode({ text: 'Hello', fontSize: 16, fontFamily: 'Inter' }),
      );
      expect(
        cacheContentParts(makeNode({ text: 'Hello', fontSize: 24, fontFamily: 'Inter' })),
      ).not.toEqual(base);
      expect(
        cacheContentParts(makeNode({ text: 'Hello', fontSize: 16, fontFamily: 'Georgia' })),
      ).not.toEqual(base);
      // Same length ('Hello' vs 'World'), different content.
      expect(
        cacheContentParts(makeNode({ text: 'World', fontSize: 16, fontFamily: 'Inter' })),
      ).not.toEqual(base);
    });

    it('changes when alphaMask is added or its length changes', () => {
      const none = cacheContentParts(makeNode({}));
      const maskA = cacheContentParts(makeNode({ alphaMask: 'data:image/png;base64,AAAA' }));
      const maskB = cacheContentParts(makeNode({ alphaMask: 'data:image/png;base64,AAAAAAAA' }));
      expect(maskA).not.toEqual(none);
      expect(maskA).not.toEqual(maskB);
    });
  });
});
