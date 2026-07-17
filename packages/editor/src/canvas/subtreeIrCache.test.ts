import type {
  Effect,
  EngineFill,
  SceneNode as EngineNode,
  FilterIR,
  RenderItem,
  Shape,
  Stroke,
} from '@strata/engine';
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

function report(en: EngineNode): string[] {
  return cacheContentParts(en).parts;
}

function sub(en: EngineNode) {
  return cacheContentParts(en).sub;
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

  describe('cacheContentParts — geometry coverage', () => {
    it('captures rect shape (existing)', () => {
      const en = makeNode({
        shape: { kind: 'rect', x: 10, y: 20, w: 100, h: 200 } as Shape,
      });
      const parts = report(en);
      expect(parts.some((p) => p.includes('rect'))).toBe(true);
      expect(parts.some((p) => p.includes('"x":10'))).toBe(true);
      expect(parts.some((p) => p.includes('"w":100'))).toBe(true);
    });

    it('captures ellipse geometry (cx, cy, rx, ry) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: { kind: 'ellipse', cx: 50, cy: 60, rx: 100, ry: 80 } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: { kind: 'ellipse', cx: 50, cy: 60, rx: 120, ry: 80 } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures circle geometry (cx, cy, r) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: { kind: 'circle', cx: 50, cy: 60, r: 30 } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: { kind: 'circle', cx: 50, cy: 60, r: 45 } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures line geometry (from, to) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: {
          kind: 'line',
          from: [0, 0] as const,
          to: [100, 100] as const,
          tolerance: 0.5,
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'line',
          from: [0, 0] as const,
          to: [200, 100] as const,
          tolerance: 0.5,
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures polygon geometry (sides, radius) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: { kind: 'polygon', cx: 0, cy: 0, radius: 50, sides: 6, rotation: 0 } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: { kind: 'polygon', cx: 0, cy: 0, radius: 50, sides: 8, rotation: 0 } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures star geometry (points, radii) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: {
          kind: 'star',
          cx: 0,
          cy: 0,
          innerRadius: 20,
          outerRadius: 50,
          points: 5,
          rotation: 0,
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'star',
          cx: 0,
          cy: 0,
          innerRadius: 30,
          outerRadius: 50,
          points: 5,
          rotation: 0,
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures arrow geometry (from, to, arrowheadSize) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: {
          kind: 'arrow',
          from: [0, 0] as const,
          to: [100, 100] as const,
          tolerance: 0.5,
          arrowheadSize: 10,
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'arrow',
          from: [0, 0] as const,
          to: [100, 100] as const,
          tolerance: 0.5,
          arrowheadSize: 20,
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures path geometry (points, closed, holes, fillRule) — CRITICAL gap closed', () => {
      const points1 = [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 100, handleIn: null, handleOut: null },
      ];
      const points2 = [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 100, handleIn: null, handleOut: null },
      ];
      const en = makeNode({
        shape: {
          kind: 'path',
          points: points1,
          closed: true,
          tolerance: 0.5,
          fillRule: 'nonzero',
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'path',
          points: points2,
          closed: true,
          tolerance: 0.5,
          fillRule: 'nonzero',
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);

      // Closed toggling
      const en3 = makeNode({
        shape: {
          kind: 'path',
          points: points1,
          closed: false,
          tolerance: 0.5,
          fillRule: 'nonzero',
        } as Shape,
      });
      const p3 = report(en3);
      expect(p1).not.toEqual(p3);

      // fillRule toggling
      const en4 = makeNode({
        shape: {
          kind: 'path',
          points: points1,
          closed: true,
          tolerance: 0.5,
          fillRule: 'evenodd',
        } as Shape,
      });
      const p4 = report(en4);
      expect(p1).not.toEqual(p4);
    });

    it('captures node-level w/h separately from shape w/h', () => {
      const en = makeNode({
        kind: 'text',
        text: 'Hello',
        fontSize: 16,
        w: 200,
        h: 50,
      });
      const p1 = report(en);
      const en2 = makeNode({
        kind: 'text',
        text: 'Hello',
        fontSize: 16,
        w: 300,
        h: 50,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures shapeless toggle', () => {
      const en1 = report(makeNode({ shapeless: false }));
      const en2 = report(makeNode({ shapeless: true }));
      expect(en1).not.toEqual(en2);
    });

    it('captures kind field', () => {
      const en1 = report(makeNode({ kind: 'text' }));
      const en2 = report(makeNode({ kind: 'shape' }));
      expect(en1).not.toEqual(en2);
    });

    it('captures rasterLayerData content version summary', () => {
      const en1 = report(
        makeNode({
          kind: 'rasterLayer',
          rasterLayerData: {
            width: 100,
            height: 200,
            pixelMode: false,
            tiles: { '0:0': { pixels: [0, 0, 0, 255], version: 1 } },
          },
        }),
      );
      const en2 = report(
        makeNode({
          kind: 'rasterLayer',
          rasterLayerData: {
            width: 100,
            height: 200,
            pixelMode: false,
            tiles: { '0:0': { pixels: [255, 0, 0, 255], version: 2 } },
          },
        }),
      );
      expect(en1).not.toEqual(en2);
    });
  });

  describe('cacheContentParts — stroke coverage', () => {
    it('changes when stroke weight changes (not just stroke count)', () => {
      const before = report(makeNode({ strokes: [makeStroke({ weight: 1 })] }));
      const after = report(makeNode({ strokes: [makeStroke({ weight: 5 })] }));
      expect(before).not.toEqual(after);
    });

    it('changes when stroke align/dash/cap/join change', () => {
      const base = report(makeNode({ strokes: [makeStroke()] }));
      expect(report(makeNode({ strokes: [makeStroke({ align: 'inside' })] }))).not.toEqual(base);
      expect(report(makeNode({ strokes: [makeStroke({ dashPattern: [4, 2] })] }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ strokes: [makeStroke({ cap: 'round' })] }))).not.toEqual(base);
      expect(report(makeNode({ strokes: [makeStroke({ join: 'round' })] }))).not.toEqual(base);
    });

    it('changes when arrowhead style changes', () => {
      const base = report(makeNode({ strokes: [makeStroke()] }));
      expect(report(makeNode({ strokes: [makeStroke({ arrowEnd: 'arrow' })] }))).not.toEqual(base);
      expect(report(makeNode({ strokes: [makeStroke({ arrowStart: 'circle' })] }))).not.toEqual(
        base,
      );
    });
  });

  describe('cacheContentParts — fill/effect visibility', () => {
    it('changes when a fill or effect toggles visibility', () => {
      const fill: EngineFill = {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      const visible = report(makeNode({ fills: [fill] }));
      const hidden = report(makeNode({ fills: [{ ...fill, visible: false }] }));
      expect(visible).not.toEqual(hidden);

      const effect: Effect = {
        type: 'layerBlur',
        radius: 4,
        visible: true,
      };
      const effectVisible = report(makeNode({ effects: [effect] }));
      const effectHidden = report(makeNode({ effects: [{ ...effect, visible: false }] }));
      expect(effectVisible).not.toEqual(effectHidden);
    });
  });

  describe('cacheContentParts — text property coverage', () => {
    it('changes when text font properties change, and distinguishes equal-length text', () => {
      const base = report(makeNode({ text: 'Hello', fontSize: 16, fontFamily: 'Inter' }));
      expect(report(makeNode({ text: 'Hello', fontSize: 24, fontFamily: 'Inter' }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ text: 'Hello', fontSize: 16, fontFamily: 'Georgia' }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ text: 'World', fontSize: 16, fontFamily: 'Inter' }))).not.toEqual(
        base,
      );
    });

    it('captures all text layout properties', () => {
      const base = report(makeNode({ text: 'Test', fontSize: 16 }));
      expect(report(makeNode({ text: 'Test', fontSize: 16, lineHeight: 2 }))).not.toEqual(base);
      expect(report(makeNode({ text: 'Test', fontSize: 16, letterSpacing: 2 }))).not.toEqual(base);
      expect(report(makeNode({ text: 'Test', fontSize: 16, textAlign: 'center' }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ text: 'Test', fontSize: 16, textCase: 'uppercase' }))).not.toEqual(
        base,
      );
      expect(
        report(makeNode({ text: 'Test', fontSize: 16, textDecoration: 'underline' })),
      ).not.toEqual(base);
    });
  });

  describe('cacheContentParts — mask coverage', () => {
    it('changes when alphaMask is added or its length changes', () => {
      const none = report(makeNode({}));
      const maskA = report(makeNode({ alphaMask: 'data:image/png;base64,AAAA' }));
      const maskB = report(makeNode({ alphaMask: 'data:image/png;base64,AAAAAAAA' }));
      expect(maskA).not.toEqual(none);
      expect(maskA).not.toEqual(maskB);
    });
  });

  describe('SubHashReport diagnostics', () => {
    it('marks geometry sub when shape changes', () => {
      const s = sub(makeNode({ shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 } as Shape }));
      expect(s.geometry).toBe(true);
      expect(s.paint).toBe(false);
    });

    it('marks paint sub when fill changes', () => {
      const s = sub(
        makeNode({
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        }),
      );
      expect(s.paint).toBe(true);
    });

    it('marks text sub when text changes', () => {
      const s = sub(makeNode({ text: 'Hello', fontSize: 16 }));
      expect(s.text).toBe(true);
    });

    it('marks effects sub when filters change', () => {
      const filter: FilterIR = { kind: 'blur', radius: 4, opacity: 1, blendMode: 'normal' };
      const s = sub(makeNode({ filters: [filter] }));
      expect(s.effects).toBe(true);
    });

    it('marks image sub when src changes', () => {
      const s = sub(makeNode({ src: 'https://example.com/img.png' }));
      expect(s.image).toBe(true);
    });

    it('marks mask sub when alphaMask present', () => {
      const s = sub(makeNode({ alphaMask: 'data:image/png;base64,AAAA' }));
      expect(s.mask).toBe(true);
    });
  });

  describe('estimateItemBytes', () => {
    it('returns positive byte estimate for a RenderItem', () => {
      const item = {
        id: 'n1',
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        primitive: { kind: 'rect', w: 100, h: 100 },
      } as unknown as RenderItem;
      const bytes = SubtreeIrCache.estimateItemBytes(item);
      expect(bytes).toBeGreaterThan(0);
      expect(Number.isFinite(bytes)).toBe(true);
    });

    it('returns fallback for non-serializable item', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      const bytes = SubtreeIrCache.estimateItemBytes(circular as unknown as RenderItem);
      expect(bytes).toBe(1024);
    });
  });

  describe('byte-based budgeting', () => {
    function makeItem() {
      return {
        id: 'n1',
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        primitive: { kind: 'rect', w: 100, h: 100 },
      } as unknown as RenderItem;
    }

    it('evicts by entry count when byte budget is ample', () => {
      const cache = new SubtreeIrCache(3, 1000000);
      cache.set('n1', 'h1', makeItem());
      cache.set('n2', 'h2', makeItem());
      cache.set('n3', 'h3', makeItem());
      cache.set('n4', 'h4', makeItem());
      expect(cache.entryCount).toBe(3);
      expect(cache.currentMemoryBytes).toBeGreaterThan(0);
    });

    it('evicts by byte budget before entry count', () => {
      const cache = new SubtreeIrCache(100, 500);
      cache.set('n1', 'h1', makeItem());
      cache.set('n2', 'h2', makeItem());
      cache.set('n3', 'h3', makeItem());
      expect(cache.entryCount).toBeLessThanOrEqual(3);
      expect(cache.currentMemoryBytes).toBeLessThanOrEqual(500);
    });

    it('accounts byte replacement correctly', () => {
      const cache = new SubtreeIrCache(10, 100000);
      cache.set('n1', 'h-a', makeItem());
      const bytesAfterFirst = cache.currentMemoryBytes;
      // Replace with different item — same key, different content
      cache.set('n1', 'h-b', makeItem());
      expect(cache.currentMemoryBytes).toBe(bytesAfterFirst);
      expect(cache.entryCount).toBe(1);
    });

    it('refuses entries exceeding soft budget', () => {
      // Tiny budget so any item is oversized
      const cache = new SubtreeIrCache(10, 10);
      cache.set('n1', 'h', makeItem());
      expect(cache.entryCount).toBe(0);
      expect(cache.currentMemoryBytes).toBe(0);
      expect(cache.recentEvictions.length).toBeGreaterThanOrEqual(1);
      expect(cache.recentEvictions[0]!.reason).toBe('oversized_entry');
    });

    it('reports diagnostics correctly', () => {
      const cache = new SubtreeIrCache(5, 10000, 20000);
      cache.set('n1', 'h', makeItem());
      const diag = cache.diagnostics();
      expect(diag.entries).toBe(1);
      expect(diag.softBudget).toBe(10000);
      expect(diag.hardBudget).toBe(20000);
      expect(diag.bytes).toBeGreaterThan(0);
      expect(diag.hits).toBe(0);
      expect(diag.misses).toBe(0);
      // One hit
      cache.get('n1', 'h');
      expect(cache.hits).toBe(1);
      expect(cache.diagnostics().hitRate).toBeGreaterThan(0);
    });

    it('clears byte accounting correctly', () => {
      const cache = new SubtreeIrCache(10, 100000);
      cache.set('n1', 'h', makeItem());
      expect(cache.currentMemoryBytes).toBeGreaterThan(0);
      cache.clear();
      expect(cache.currentMemoryBytes).toBe(0);
      expect(cache.entryCount).toBe(0);
      expect(cache.hits).toBe(0);
      expect(cache.misses).toBe(0);
    });

    it('decrements bytes on single-node invalidation', () => {
      const cache = new SubtreeIrCache(10, 100000);
      cache.set('n1', 'h', makeItem());
      cache.set('n2', 'h', makeItem());
      const before = cache.currentMemoryBytes;
      cache.invalidate('n1');
      expect(cache.currentMemoryBytes).toBeLessThan(before);
      expect(cache.entryCount).toBe(1);
    });
  });
});
