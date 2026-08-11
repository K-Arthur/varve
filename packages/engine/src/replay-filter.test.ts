/**
 * Tests for nondestructive adjustment filter application in replay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFilterChain } from './filters';
import type { RenderItem } from './types';

const applyFilterWithCompositingSpy = vi.fn();
vi.mock('./filterCompositor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./filterCompositor')>();
  return {
    ...actual,
    applyFilterWithCompositing: (...args: Parameters<typeof actual.applyFilterWithCompositing>) => {
      applyFilterWithCompositingSpy(...args);
    },
  };
});

const { replayIr } = await import('./replay');

function makeRecorder(): {
  calls: string[];
  target: Parameters<typeof replayIr>[0];
} {
  const calls: string[] = [];
  let filter = 'none';
  const canvas = { width: 100, height: 100 };
  return {
    calls,
    target: {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      canvas,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      setTransform: () => calls.push('setTransform'),
      drawImage: () => calls.push('drawImage'),
      transform: () => calls.push('transform'),
      translate: () => calls.push('translate'),
      rotate: () => calls.push('rotate'),
      scale: () => calls.push('scale'),
      fillRect: () => calls.push('fillRect'),
      strokeRect: () => calls.push('strokeRect'),
      beginPath: () => calls.push('beginPath'),
      rect: () => calls.push('rect'),
      ellipse: () => calls.push('ellipse'),
      arc: () => calls.push('arc'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      bezierCurveTo: () => calls.push('bezierCurveTo'),
      fill: () => calls.push(`fill filter=${filter}`),
      stroke: () => calls.push('stroke'),
      closePath: () => calls.push('closePath'),
      clip: () => calls.push('clip'),
      fillText: () => calls.push('fillText'),
      roundRect: () => calls.push('roundRect'),
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      textAlign: 'left',
      strokeStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      get filter() {
        return filter;
      },
      set filter(v: string) {
        filter = v;
      },
      lineDashOffset: 0,
      setLineDash: () => calls.push('setLineDash'),
    },
  };
}

function rectItem(w: number, h: number): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [
      {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    primitive: { kind: 'rect', x: 0, y: 0, w, h, cornerRadius: 2 },
    opacity: 1,
    blendMode: 'normal',
  };
}

describe('applyFilterChain', () => {
  it('sets filter on a plain target', () => {
    const { target } = makeRecorder();
    applyFilterChain(target, [{ kind: 'brightness', value: 30, opacity: 1, blendMode: 'normal' }]);
    expect(target.filter).toBe('brightness(130%)');
  });
});

describe('replay filter chain', () => {
  beforeEach(() => {
    applyFilterWithCompositingSpy.mockClear();
  });

  it('sets filter from CSS-convertible filters', () => {
    const { target, calls } = makeRecorder();
    const item = {
      ...rectItem(10, 10),
      filters: [
        { kind: 'brightness' as const, value: 30, opacity: 1, blendMode: 'normal' as const },
      ],
    };
    replayIr(target, [item]);
    expect(calls.some((c) => c === 'fill filter=brightness(130%)')).toBe(true);
  });

  it('does not leak a CSS filter string when no CSS equivalent exists', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      {
        ...rectItem(10, 10),
        filters: [
          {
            kind: 'exposure' as const,
            value: 1,
            offset: 0,
            gammaCorrection: 1,
            opacity: 1,
            blendMode: 'normal' as const,
          },
        ],
      },
    ]);
    expect(calls.some((c) => c.startsWith('fill filter=') && c !== 'fill filter=none')).toBe(false);
  });

  it.each([
    {
      kind: 'exposure' as const,
      value: 1,
      offset: 0,
      gammaCorrection: 1,
      opacity: 1,
      blendMode: 'normal' as const,
    },
    {
      kind: 'halftone' as const,
      pattern: 'dot' as const,
      frequency: 45,
      angle: 45,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
      opacity: 1,
      blendMode: 'normal' as const,
    },
    {
      kind: 'curves' as const,
      channel: 'rgb' as const,
      points: [],
      opacity: 1,
      blendMode: 'normal' as const,
    },
  ])(
    'routes non-CSS filter $kind at default opacity/blendMode to pixel-level compositing instead of silently dropping it',
    (filter) => {
      const { target } = makeRecorder();
      replayIr(target, [{ ...rectItem(10, 10), filters: [filter] }]);
      expect(applyFilterWithCompositingSpy).toHaveBeenCalledTimes(1);
      const [, appliedFilters] = applyFilterWithCompositingSpy.mock.calls[0]!;
      expect(appliedFilters).toEqual([filter]);
    },
  );

  it('applies complex filters to an isolated item surface without clearing prior layers', () => {
    const { target, calls } = makeRecorder();
    const filter = {
      kind: 'exposure' as const,
      value: 1,
      offset: 0,
      gammaCorrection: 1,
      opacity: 1,
      blendMode: 'normal' as const,
    };

    replayIr(target, [{ ...rectItem(10, 10), filters: [filter] }]);

    const [filterTarget] = applyFilterWithCompositingSpy.mock.calls[0]!;
    expect(filterTarget).not.toBe(target);
    expect(calls).not.toContain('clearRect');
    expect(calls).toContain('drawImage');
  });

  it('composes multiple convertible filters into one filter string', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      {
        ...rectItem(10, 10),
        filters: [
          { kind: 'brightness' as const, value: 10, opacity: 1, blendMode: 'normal' as const },
          { kind: 'blur' as const, radius: 4, opacity: 1, blendMode: 'normal' as const },
        ],
      },
    ]);
    expect(calls.some((c) => c === 'fill filter=brightness(110%) blur(4px)')).toBe(true);
  });
});

describe('replay glass material effect', () => {
  it('handles glassMaterial effect without crashing (bails out when OffscreenCanvas unavailable)', () => {
    const { target } = makeRecorder();
    const item: RenderItem = {
      ...rectItem(10, 10),
      effects: [
        {
          type: 'glassMaterial',
          blur: 12,
          tint: { space: 'rgb', r: 200, g: 220, b: 255, a: 255 },
          tintOpacity: 0.3,
          saturation: 1.2,
          brightness: 1.05,
          noise: 0.02,
          edgeHighlight: true,
          edgeHighlightWidth: 1.5,
          edgeHighlightColor: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
          edgeHighlightOpacity: 0.4,
          visible: true,
        },
      ],
    };
    expect(() => replayIr(target, [item])).not.toThrow();
  });

  it('skips invisible glassMaterial effect', () => {
    const { target } = makeRecorder();
    const item: RenderItem = {
      ...rectItem(10, 10),
      effects: [
        {
          type: 'glassMaterial',
          blur: 12,
          tint: { space: 'rgb', r: 200, g: 220, b: 255, a: 255 },
          tintOpacity: 0.3,
          saturation: 1.2,
          brightness: 1.05,
          noise: 0.02,
          edgeHighlight: false,
          edgeHighlightWidth: 0,
          edgeHighlightColor: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
          edgeHighlightOpacity: 0,
          visible: false,
        },
      ],
    };
    expect(() => replayIr(target, [item])).not.toThrow();
  });
});
