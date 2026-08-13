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
});
