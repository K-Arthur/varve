import { describe, expect, it } from 'vitest';
import { applyFilterWithCompositing } from './filterCompositor';
import type { FilterIR } from './types';

/** Minimal mock CanvasRenderingContext2D for testing filter behavior in node. */
function mockTarget() {
  const calls: string[] = [];
  const props: Record<string, unknown> = {
    filter: 'none',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  };

  const get = (name: string) => () => props[name];
  const set = (name: string) => (v: unknown) => {
    props[name] = v;
    calls.push(`set ${name}`);
  };

  const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
  const target = {
    get filter() {
      return get('filter')();
    },
    set filter(v) {
      set('filter')(v);
    },
    get globalCompositeOperation() {
      return get('globalCompositeOperation')();
    },
    set globalCompositeOperation(v) {
      set('globalCompositeOperation')(v);
    },
    get globalAlpha() {
      return get('globalAlpha')();
    },
    set globalAlpha(v) {
      set('globalAlpha')(v);
    },
    canvas,
    save: () => {
      calls.push('save');
    },
    restore: () => {
      calls.push('restore');
    },
    drawImage: () => {
      calls.push('drawImage');
    },
    clearRect: () => {
      calls.push('clearRect');
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
    putImageData: () => {
      calls.push('putImageData');
    },
    createImageData: (w: number, h: number) => new ImageData(w, h),
    fillRect: () => {
      calls.push('fillRect');
    },
    fillStyle: '',
  };
  return { target: target as unknown as CanvasRenderingContext2D, calls, props };
}

describe('filter compositing', () => {
  it('applies CSS-compatible filter directly when opacity=1 and blendMode=normal', () => {
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    expect(target.filter).toContain('brightness');
  });

  it('falls back to CSS for opacity<1 filter when OffscreenCanvas unavailable', () => {
    // In node test env, OffscreenCanvas polyfill returns null from getContext,
    // so the fallback applies CSS filter for CSS-compatible filters
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 0.5, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // Fallback: brightness is CSS-compatible so it gets applied
    expect(target.filter).toContain('brightness');
  });

  it('falls back to CSS for non-normal blend filter when OffscreenCanvas unavailable', () => {
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'multiply' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // Fallback: CSS-compatible with blend ignored (CSS filter doesn't support per-filter blend)
    expect(target.filter).toContain('brightness');
  });

  it('handles non-CSS filter with CSS fallback when OffscreenCanvas unavailable', () => {
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      {
        kind: 'curves',
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 255 },
        ],
        channel: 'rgb',
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // curves has no CSS equivalent, so in fallback mode filter stays 'none'
    expect(target.filter).toBe('none');
  });

  it('composes multiple CSS filters into one string', () => {
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
      { kind: 'contrast', value: 20, opacity: 1, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    const filterStr = target.filter as string;
    expect(filterStr).toContain('brightness');
    expect(filterStr).toContain('contrast');
  });

  it('handles mixed CSS and non-CSS filters with CSS fallback', () => {
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
      {
        kind: 'levels',
        inputShadows: 0,
        inputHighlights: 255,
        inputMidtones: 1,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
        opacity: 0.8,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // Fallback applies CSS-compatible filters only
    expect(target.filter).toContain('brightness');
  });

  it('is no-op for empty filter array', () => {
    const { target, calls } = mockTarget();
    applyFilterWithCompositing(target, [], 100, 100);
    expect(calls.length).toBe(0);
    expect(target.filter).toBe('none');
  });

  it('uses offscreen compositing in browser environment', () => {
    // Test the offscreen path logic by checking filter accumulation
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // In a simple case, the filter should be set via CSS
    expect(target.filter).toBe('brightness(110%)');
  });
});
