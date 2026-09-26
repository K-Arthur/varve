import type { EngineColor, RenderItem } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { resolveGpuSolidPaint } from './solidPaint';
import { isGpuBatchSupported } from './webgpu/backend';

const RED: EngineColor = { space: 'rgb', r: 200, g: 30, b: 30, a: 255 };
const TEAL: EngineColor = { space: 'rgb', r: 57, g: 208, b: 198, a: 128 };

const solidFill = (color: EngineColor, overrides: Record<string, unknown> = {}) => ({
  type: 'solid' as const,
  color,
  opacity: 1,
  blendMode: 'normal' as const,
  visible: true,
  ...overrides,
});

const rect = (overrides: Partial<RenderItem> = {}): RenderItem => ({
  transform: [1, 0, 0, 1, 0, 0],
  fill: RED,
  primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
  opacity: 1,
  blendMode: 'normal',
  strokes: [],
  effects: [],
  ...overrides,
});

describe('resolveGpuSolidPaint', () => {
  it('uses the legacy singular fill when no stack is present', () => {
    expect(resolveGpuSolidPaint(rect())).toEqual({ color: RED, opacity: 1 });
  });

  it('falls back to the singular fill for an empty stack', () => {
    const item = rect({ fills: [] });
    expect(resolveGpuSolidPaint(item)).toEqual({ color: RED, opacity: 1 });
  });

  it('resolves a single visible solid stack entry with its own opacity', () => {
    const item = rect({ fills: [solidFill(TEAL, { opacity: 0.5 })] });
    expect(resolveGpuSolidPaint(item)).toEqual({ color: TEAL, opacity: 0.5 });
  });

  it('ignores invisible stack entries', () => {
    const item = rect({
      fills: [solidFill(RED, { visible: false }), solidFill(TEAL, { opacity: 0.25 })],
    });
    expect(resolveGpuSolidPaint(item)).toEqual({ color: TEAL, opacity: 0.25 });
  });

  it('rejects stacked visible paints', () => {
    const item = rect({ fills: [solidFill(RED), solidFill(TEAL)] });
    expect(resolveGpuSolidPaint(item)).toBeNull();
  });

  it('rejects non-solid paints', () => {
    const item = rect({
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    expect(resolveGpuSolidPaint(item)).toBeNull();
  });

  it('rejects non-normal fill blending', () => {
    const item = rect({ fills: [solidFill(RED, { blendMode: 'multiply' })] });
    expect(resolveGpuSolidPaint(item)).toBeNull();
  });
});

describe('isGpuBatchSupported with fills stacks', () => {
  it('admits a batch of single-solid-stack rects', () => {
    const items = [rect({ fills: [solidFill(TEAL)] }), rect({ fills: [solidFill(RED)] })];
    expect(isGpuBatchSupported(items)).toBe(true);
  });

  it('still rejects stack items carrying strokes, effects, or item blending', () => {
    const stack = [solidFill(TEAL)];
    expect(isGpuBatchSupported([rect({ fills: stack, strokes: [] })])).toBe(true);
    expect(
      isGpuBatchSupported([
        rect({
          fills: stack,
          strokes: [
            {
              color: RED,
              weight: 1,
              align: 'center' as const,
              dashPattern: [],
              dashOffset: 0,
              cap: 'round' as const,
              join: 'round' as const,
              miterLimit: 4,
              visible: true,
            },
          ],
        }),
      ]),
    ).toBe(false);
    expect(
      isGpuBatchSupported([
        rect({ fills: stack, effects: [{ type: 'layerBlur', radius: 4, visible: true }] }),
      ]),
    ).toBe(false);
    expect(isGpuBatchSupported([rect({ fills: stack, blendMode: 'multiply' })])).toBe(false);
  });
});
