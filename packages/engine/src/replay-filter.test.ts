/**
 * Tests for nondestructive adjustment filter application in replay.
 */
import { describe, expect, it } from 'vitest';
import { applyFilterChain } from './filters';
import { replayIr } from './replay';
import type { RenderItem } from './types';

function makeRecorder(): {
  calls: string[];
  target: Parameters<typeof replayIr>[0];
} {
  const calls: string[] = [];
  let filter = 'none';
  return {
    calls,
    target: {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      transform: () => calls.push('transform'),
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
    fill: [0, 0, 0, 255],
    fills: [
      { type: 'solid', color: [255, 0, 0, 255], opacity: 1, blendMode: 'normal', visible: true },
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

  it('does not set filter when no CSS equivalent exists', () => {
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
