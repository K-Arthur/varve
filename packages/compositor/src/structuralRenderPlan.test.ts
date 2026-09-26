import type { RenderItem } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { buildStructuralRenderPlan } from './structuralRenderPlan';

const rect = (overrides: Partial<RenderItem> = {}): RenderItem => ({
  transform: [1, 0, 0, 1, 0, 0],
  fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
  primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
  ...overrides,
});

describe('buildStructuralRenderPlan', () => {
  it('keeps GPU and Canvas2D content in exact ordered runs', () => {
    const plan = buildStructuralRenderPlan([
      rect(),
      rect({ primitive: { kind: 'text', text: 'matte', x: 0, y: 0, w: 10, h: 10 } as never }),
      rect(),
    ]);

    expect(plan.segments.map((segment) => [segment.kind, segment.start, segment.end])).toEqual([
      ['webgpu-run', 0, 1],
      ['canvas2d-island', 1, 2],
      ['webgpu-run', 2, 3],
    ]);
    expect(plan.fallbackReasons.text).toBe(1);
  });

  it('expands an unsupported child to the declared semantic boundary', () => {
    const plan = buildStructuralRenderPlan(
      [
        rect(),
        rect({ effects: [{ type: 'layerBlur', radius: 4, visible: true }] as never }),
        rect(),
      ],
      {
        itemStart: 0,
        itemEnd: 3,
        children: [
          { itemStart: 0, itemEnd: 1 },
          { itemStart: 1, itemEnd: 2 },
          { itemStart: 2, itemEnd: 3 },
        ],
        fallbackBoundary: true,
        fallbackReason: 'structural-group',
      },
    );

    expect(plan.segments.map((segment) => segment.kind)).toEqual(['canvas2d-island']);
    expect(plan.segments[0]?.reasons).toEqual(['structural-group']);
  });

  it('does not allocate a fallback island for a fully supported sequence', () => {
    const plan = buildStructuralRenderPlan([rect(), rect()]);
    expect(plan.fallbackIslandCount).toBe(0);
    expect(plan.nativeWebGpuItems).toBe(2);
    expect(plan.segments).toHaveLength(1);
  });

  it('admits a single visible solid fill from the fills stack as a GPU run', () => {
    const plan = buildStructuralRenderPlan([
      rect({
        fills: [
          {
            type: 'solid',
            color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
      } as Partial<RenderItem>),
    ]);
    expect(plan.fallbackIslandCount).toBe(0);
    expect(plan.nativeWebGpuItems).toBe(1);
  });

  it('routes solid ellipse primitives to GPU runs like circles', () => {
    const plan = buildStructuralRenderPlan([
      rect({
        fills: [
          {
            type: 'solid',
            color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'ellipse', cx: 0, cy: 0, rx: 20, ry: 10 },
      }),
    ]);
    expect(plan.fallbackIslandCount).toBe(0);
    expect(plan.nativeWebGpuItems).toBe(1);
  });

  it('keeps stacked, non-solid, and blended fills on the Canvas2D island', () => {
    const solid = {
      type: 'solid' as const,
      color: { space: 'rgb' as const, r: 1, g: 2, b: 3, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      visible: true,
    };
    const plan = buildStructuralRenderPlan([
      rect({ fills: [solid, solid] } as Partial<RenderItem>),
      rect({
        fills: [{ ...solid, blendMode: 'multiply' as const }],
      } as Partial<RenderItem>),
      rect({
        fills: [
          {
            type: 'gradient' as const,
            gradientType: 'linear' as const,
            stops: [],
            rotation: 0,
            opacity: 1,
            blendMode: 'normal' as const,
            visible: true,
          },
        ],
      } as Partial<RenderItem>),
    ]);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]?.kind).toBe('canvas2d-island');
    // Reasons count per merged island; all three items merged into one.
    expect(plan.fallbackReasons['unsupported-paint']).toBe(1);
    expect(plan.fallbackNodeCount).toBe(3);
  });

  it('ignores invisible stack entries when deciding GPU admission', () => {
    const plan = buildStructuralRenderPlan([
      rect({
        fills: [
          {
            type: 'solid',
            color: { space: 'rgb', r: 9, g: 9, b: 9, a: 255 },
            opacity: 1,
            blendMode: 'normal',
            visible: false,
          },
          {
            type: 'solid',
            color: { space: 'rgb', r: 57, g: 208, b: 198, a: 128 },
            opacity: 0.5,
            blendMode: 'normal',
            visible: true,
          },
        ],
      } as Partial<RenderItem>),
      rect({ fills: [] } as Partial<RenderItem>),
    ]);
    // The visible translucent solid is GPU-eligible; the empty stack falls
    // back to the legacy singular fill, so both items stay GPU runs.
    expect(plan.fallbackIslandCount).toBe(0);
    expect(plan.nativeWebGpuItems).toBe(2);
  });

  it('routes rounded and smoothed rectangles through the accurate fallback', () => {
    const plan = buildStructuralRenderPlan([
      rect(),
      rect({ primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10, cornerRadius: 4 } }),
      rect({
        primitive: {
          kind: 'rect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          cornerRadius: 4,
          cornerSmoothing: 0.5,
        },
      }),
      rect(),
    ]);
    expect(plan.segments.map((segment) => segment.kind)).toEqual([
      'webgpu-run',
      'canvas2d-island',
      'webgpu-run',
    ]);
    expect(plan.fallbackReasons['unsupported-primitive']).toBe(1);
  });

  it('falls back for unsupported leaves outside an already-created boundary', () => {
    const plan = buildStructuralRenderPlan(
      [
        rect({ effects: [{ type: 'layerBlur', radius: 4, visible: true }] as never }),
        rect(),
        rect({ primitive: { kind: 'text', text: 'label', x: 0, y: 0, w: 10, h: 10 } as never }),
      ],
      {
        itemStart: 0,
        itemEnd: 3,
        children: [
          { itemStart: 0, itemEnd: 1, fallbackBoundary: true, fallbackReason: 'structural-group' },
          { itemStart: 1, itemEnd: 3 },
        ],
      },
    );

    // The text leaf is outside the declared boundary and must not be emitted
    // as a GPU run. Before the fix, an existing boundary suppressed the whole
    // per-item scan and the text item became "native WebGPU".
    expect(plan.segments.map((segment) => [segment.kind, segment.start, segment.end])).toEqual([
      ['canvas2d-island', 0, 1],
      ['webgpu-run', 1, 2],
      ['canvas2d-island', 2, 3],
    ]);
    expect(plan.fallbackReasons.text).toBe(1);
    expect(plan.nativeWebGpuItems).toBe(1);
  });

  it('honors a declared boundary even when every leaf looks supported', () => {
    const plan = buildStructuralRenderPlan([rect(), rect()], {
      itemStart: 0,
      itemEnd: 2,
      fallbackBoundary: true,
      fallbackReason: 'structural-group',
    });

    // Semantically unsupported groups (isolation, blend, mask, adjustment)
    // have GPU-looking leaves; a leaf-only scan cannot detect them.
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]?.kind).toBe('canvas2d-island');
    expect(plan.segments[0]?.reasons).toEqual(['structural-group']);
    expect(plan.nativeWebGpuItems).toBe(0);
    expect(plan.fallbackIslandCount).toBe(1);
  });

  it('collapses a nested boundary into its enclosing boundary', () => {
    const plan = buildStructuralRenderPlan([rect(), rect(), rect()], {
      itemStart: 0,
      itemEnd: 3,
      fallbackBoundary: true,
      fallbackReason: 'structural-group',
      children: [
        { itemStart: 0, itemEnd: 1 },
        {
          itemStart: 1,
          itemEnd: 2,
          fallbackBoundary: true,
          fallbackReason: 'blend',
        },
      ],
    });

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toMatchObject({ kind: 'canvas2d-island', start: 0, end: 3 });
    expect(plan.segments[0]?.reasons).toEqual(['structural-group']);
    expect(plan.nativeWebGpuItems).toBe(0);
  });
});
