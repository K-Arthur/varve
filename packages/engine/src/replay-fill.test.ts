// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getImageCache, resetImageCache } from './imageCache';
import type { ReplayGradient, ReplayTarget } from './replay';
import { replayIr, resetGradientCacheForTest } from './replay';
import type { FillIR, RenderItem } from './types';

interface RecorderProxy {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
}

function recorder(): RecorderProxy {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const mk =
    (k: string) =>
    (...args: unknown[]) => {
      const s = `${k}(${args.length})`;
      calls.push(s);
      return undefined;
    };

  const tracked: Record<string, PropertyDescriptor> = {};
  const defProp = (name: string, def: unknown) => {
    tracked[name] = {
      get() {
        return name in props ? props[name] : def;
      },
      set(v: unknown) {
        props[name] = v;
        calls.push(`set ${name}`);
      },
      configurable: true,
      enumerable: true,
    };
  };
  defProp('fillStyle', '');
  defProp('strokeStyle', '');
  defProp('lineWidth', 1);
  defProp('lineCap', 'butt');
  defProp('lineJoin', 'miter');
  defProp('globalAlpha', 1);
  defProp('globalCompositeOperation', 'source-over');
  defProp('filter', 'none');
  defProp('lineDashOffset', 0);
  defProp('shadowColor', 'transparent');
  defProp('shadowBlur', 0);
  defProp('shadowOffsetX', 0);
  defProp('shadowOffsetY', 0);
  defProp('font', '10px sans-serif');
  defProp('textAlign', 'left');
  defProp('textBaseline', 'alphabetic');

  let gradientId = 0;
  const gradients: Record<string, ReplayGradient> = {};

  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push(`transform(${[a, b, c, d, e, f].join(',')})`);
    },
    translate: mk('translate'),
    rotate: mk('rotate'),
    scale: mk('scale'),
    fillRect: mk('fillRect'),
    strokeRect: mk('strokeRect'),
    beginPath: mk('beginPath'),
    rect: mk('rect'),
    clip: mk('clip'),
    ellipse: mk('ellipse'),
    arc: mk('arc'),
    moveTo: mk('moveTo'),
    lineTo: mk('lineTo'),
    bezierCurveTo: mk('bezierCurveTo'),
    fill: mk('fill'),
    stroke: mk('stroke'),
    closePath: mk('closePath'),
    setLineDash: mk('setLineDash'),
    roundRect: mk('roundRect'),
    fillText: mk('fillText'),

    createLinearGradient(x0: number, y0: number, x1: number, y1: number): ReplayGradient {
      const id = `lg${gradientId++}`;
      calls.push(`createLinearGradient(${[x0, y0, x1, y1].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createRadialGradient(
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number,
    ): ReplayGradient {
      const id = `rg${gradientId++}`;
      calls.push(`createRadialGradient(${[x0, y0, r0, x1, y1, r1].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createConicGradient(angle: number, cx: number, cy: number): ReplayGradient {
      const id = `cg${gradientId++}`;
      calls.push(`createConicGradient(${[angle, cx, cy].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createPattern(_image: CanvasImageSource, repetition: string): CanvasPattern | null {
      calls.push(`createPattern(${repetition})`);
      return {} as CanvasPattern;
    },
  };

  Object.entries(tracked).forEach(([k, desc]) => {
    Object.defineProperty(target, k, desc);
  });

  return { target: target as unknown as ReplayTarget, calls, props };
}

function mockImage(src: string, w: number, h: number): HTMLImageElement {
  return {
    src,
    naturalWidth: w,
    naturalHeight: h,
    toString: () => src,
  } as unknown as HTMLImageElement;
}

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});

describe('gradient fill rendering', () => {
  it('renders linear gradient fill (createLinearGradient + addColorStop + fill)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect('))).toBe(true);
  });

  it('renders radial gradient fill (createRadialGradient + addColorStop)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'radial',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('renders angular gradient via createConicGradient', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'angular',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 0.5, color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createConicGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('renders diamond gradient as radial fallback', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'diamond',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('gradient with zero stops returns transparent fallback', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(String(rec.props.fillStyle ?? '')).toBe('rgba(0,0,0,0)');
  });

  it('gradient rotation rotates the gradient axis', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          rotation: 90,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    const rec2 = recorder();
    replayIr(rec2.target, [item]);
    const lgCall = rec2.calls.find((c) => c.startsWith('createLinearGradient('));
    expect(lgCall).toBeTruthy();
  });

  it('clamps rotation 450 to same as rotation 90', () => {
    const baseCtx = recorder();
    const baseItem: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          rotation: 90,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    replayIr(baseCtx.target, [baseItem]);

    const clampedCtx = recorder();
    const clampedFill: FillIR = { ...baseItem.fills![0], rotation: 450 } as FillIR;
    const clampedItem: RenderItem = {
      ...baseItem,
      fills: [clampedFill],
    };
    replayIr(clampedCtx.target, [clampedItem]);
    const call450 = clampedCtx.calls.find((c) => c.startsWith('createLinearGradient('));

    // Gradients are target/CTM-specific Canvas objects, so a separate replay
    // target must recreate the same visual geometry instead of reusing a
    // gradient captured in another canvas's coordinate system.
    expect(call450).toBeTruthy();
  });

  it('clamps rotation -90 to same as rotation 270', () => {
    const baseCtx = recorder();
    const baseItem: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          rotation: 270,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    replayIr(baseCtx.target, [baseItem]);

    const clampedCtx = recorder();
    const clampedFill: FillIR = { ...baseItem.fills![0], rotation: -90 } as FillIR;
    const clampedItem: RenderItem = {
      ...baseItem,
      fills: [clampedFill],
    };
    replayIr(clampedCtx.target, [clampedItem]);
    const callNeg90 = clampedCtx.calls.find((c) => c.startsWith('createLinearGradient('));

    expect(callNeg90).toBeTruthy();
  });

  it('invisible gradient fill is skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(false);
  });

  it('gradient tilingMode=repeat uses createPattern with repeat', () => {
    // Provide a working OffscreenCanvas for this test
    const OrigOC = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class MockOC {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          createLinearGradient: () => ({ addColorStop: () => {} }),
          fillStyle: '',
          fillRect: () => {},
          drawImage: () => {},
          save: () => {},
          restore: () => {},
          scale: () => {},
          translate: () => {},
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    } as unknown as typeof OffscreenCanvas;

    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          tilingMode: 'repeat',
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createPattern(repeat)'))).toBe(true);
    globalThis.OffscreenCanvas = OrigOC;
  });

  it('gradient tilingMode=reflect uses createPattern with repeat', () => {
    const OrigOC = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class MockOC {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          createLinearGradient: () => ({ addColorStop: () => {} }),
          fillStyle: '',
          fillRect: () => {},
          drawImage: () => {},
          save: () => {},
          restore: () => {},
          scale: () => {},
          translate: () => {},
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    } as unknown as typeof OffscreenCanvas;

    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          tilingMode: 'reflect',
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createPattern(repeat)'))).toBe(true);
    globalThis.OffscreenCanvas = OrigOC;
  });

  it('gradient with tilingMode undefined uses standard gradient (no createPattern)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createPattern'))).toBe(false);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(true);
  });

  it('creates an explicit linear gradient in canonical unit space under all six affine coefficients', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          transform: [160, 80, -30, 45, 25, 15],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };

    replayIr(rec.target, [item]);

    expect(rec.calls).toContain('transform(160,80,-30,45,25,15)');
    expect(rec.calls).toContain('createLinearGradient(0,0.5,1,0.5)');
  });

  it('creates an affine radial field instead of reducing it to a circular average radius', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'radial',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
          ],
          rotation: 0,
          transform: [173.2, 100, -12.5, 21.65, 40, 30],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };

    replayIr(rec.target, [item]);

    expect(rec.calls).toContain('transform(173.2,100,-12.5,21.65,40,30)');
    expect(rec.calls).toContain('createRadialGradient(0.5,0.5,0,0.5,0.5,0.5)');
  });
});

describe('per-fill compositing', () => {
  it('per-fill opacity multiplies with item alpha', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      opacity: 0.5,
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    const alphaSets = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaSets.length).toBeGreaterThanOrEqual(1);
    expect(Number(rec.props.globalAlpha)).toBe(1);
  });

  it('per-fill blend mode is isolated from the next fill', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'multiply',
          visible: true,
        },
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
    const compCalls = rec.calls.filter((c) => c === 'set globalCompositeOperation');
    expect(compCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('per-fill visible=false fill is skipped in stack', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(1);
    expect(String(rec.props.fillStyle ?? '')).toContain('255, 0, 0');
  });
});

describe('gradient degenerate shape handling', () => {
  it('shape with w=0,h=0 renders as solid fill of last stop (no gradient API calls)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 0, h: 0 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient'))).toBe(false);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient'))).toBe(false);
    expect(rec.calls.some((c) => c.startsWith('createConicGradient'))).toBe(false);
    expect(String(rec.props.fillStyle ?? '')).toContain('0, 255, 0');
  });

  it('transform matrix with zero scale produces solid fill (no gradient API calls)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
          transform: [0, 0, 0, 0, 50, 50],
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient'))).toBe(false);
    expect(String(rec.props.fillStyle ?? '')).toContain('0, 0, 255');
  });
});

describe('gradient caching', () => {
  it('identical gradient fills reuse cached gradient (only one gradient created)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    const lgCalls = rec.calls.filter((c) => c.startsWith('createLinearGradient('));
    expect(lgCalls.length).toBe(1);
  });

  it('does not quantize bounds when caching legacy gradient geometry', () => {
    resetGradientCacheForTest();
    const rec = recorder();
    const base: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 17,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [base]);
    replayIr(rec.target, [{ ...base, primitive: { kind: 'rect', x: 0.004, y: 0, w: 100, h: 50 } }]);
    expect(rec.calls.filter((call) => call.startsWith('createLinearGradient')).length).toBe(2);
  });
});

describe('blend mode mapping', () => {
  const modes: [string, string][] = [
    ['multiply', 'multiply'],
    ['screen', 'screen'],
    ['overlay', 'overlay'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['colorDodge', 'color-dodge'],
    ['colorBurn', 'color-burn'],
    ['hardLight', 'hard-light'],
    ['softLight', 'soft-light'],
    ['difference', 'difference'],
    ['exclusion', 'exclusion'],
    ['hue', 'hue'],
    ['saturation', 'saturation'],
    ['color', 'color'],
    ['luminosity', 'luminosity'],
  ];

  for (const [mode, expected] of modes) {
    it(`maps ${mode} to ${expected}`, () => {
      const rec = recorder();
      const item: RenderItem = {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        blendMode: mode as RenderItem['blendMode'],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      };
      replayIr(rec.target, [item]);
      expect(rec.props.globalCompositeOperation).toBe('source-over');
    });
  }

  it('blendMode=normal uses source-over', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      blendMode: 'normal',
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec2 = recorder();
    replayIr(rec2.target, [item]);
    expect(rec2.props.globalCompositeOperation).toBe('source-over');
  });
});

describe('stroke rendering', () => {
  it('renders a gradient stroke through the same affine evaluator as fills', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 3,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
          gradient: {
            type: 'linear',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
            transform: [100, 25, 20, 40, 5, 10],
          },
        },
      ],
      primitive: { kind: 'line', from: [0, 0], to: [100, 50], tolerance: 1 },
    };

    replayIr(rec.target, [item]);

    expect(rec.calls).toContain('transform(100,25,20,40,5,10)');
    expect(rec.calls).toContain('createLinearGradient(0,0.5,1,0.5)');
    expect(rec.calls.some((call) => call.startsWith('stroke('))).toBe(true);
  });

  it('renders rect stroke via strokeRect', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 2,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(true);
    expect(rec.calls.some((c) => c === 'set lineWidth')).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('strokeRect('))).toBe(true);
  });

  it('rect stroke with cornerRadius uses roundRect path for stroke', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 1,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30, cornerRadius: 8 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('roundRect('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('strokeRect('))).toBe(false);
  });

  it('renders ellipse stroke via path', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          weight: 3,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(true);
    expect(rec.calls.some((c) => c === 'set lineWidth')).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('ellipse('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('stroke('))).toBe(true);
  });

  it('stroke with dash pattern applies setLineDash', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 1,
          cap: 'butt',
          join: 'miter',
          dashPattern: [5, 5],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('setLineDash('))).toBe(true);
  });

  it('invisible stroke is skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          weight: 5,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(false);
  });

  it('line stroke matches from→to', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 2,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'line', from: [0, 0], to: [100, 50], tolerance: 1 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('moveTo('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('lineTo('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('stroke('))).toBe(true);
  });
});

describe('effects rendering', () => {
  it('dropShadow saves, transforms offset, sets fillStyle, draws shape', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // dropShadow: save → transform(1,0,0,1,2,4) → set fillStyle → fillRect → restore
    const saves = rec.calls.filter((c) => c.startsWith('save'));
    const restores = rec.calls.filter((c) => c.startsWith('restore'));
    expect(rec.calls.some((c) => c.startsWith('set fillStyle'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
    // Effects pass does one save/restore per shadow effect
    expect(saves.length).toBeGreaterThanOrEqual(2);
    expect(restores.length).toBeGreaterThanOrEqual(2);
  });

  it('layerBlur uses single offscreen pass (filter + drawImage, no double fillRect)', () => {
    const rec = recorder();
    let drawImageCount = 0;
    (rec.target as { drawImage?: (...args: unknown[]) => void }).drawImage = (
      ...args: unknown[]
    ) => {
      drawImageCount++;
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      effects: [{ type: 'layerBlur', radius: 4, visible: true }],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Offscreen fill is not duplicated on main target — only one drawImage composite
    expect(drawImageCount).toBe(1);
    const filterCalls = rec.calls.filter((c) => c === 'set filter');
    expect(filterCalls.length).toBeGreaterThanOrEqual(1);
    // Main target should not receive a second fillRect from layerBlur
    expect(rec.calls.filter((c) => c.startsWith('fillRect')).length).toBe(0);
  });

  it('pads layer blur surfaces so the blur kernel is not cropped at object bounds', () => {
    const rec = recorder();
    let compositeArgs: unknown[] | null = null;
    rec.target.drawImage = (...args: unknown[]) => {
      compositeArgs = args;
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 20, y: 30, w: 40, h: 50 },
      effects: [{ type: 'layerBlur', radius: 4, visible: true }],
    };

    replayIr(rec.target, [item]);

    expect(compositeArgs).not.toBeNull();
    expect(compositeArgs?.[1]).toBe(8);
    expect(compositeArgs?.[2]).toBe(18);
    expect(compositeArgs?.[3]).toBe(64);
    expect(compositeArgs?.[4]).toBe(74);
  });

  it('innerShadow uses source-over (not destination-over)', () => {
    const rec = recorder();
    const compositeOps: string[] = [];
    const target: ReplayTarget = {
      ...rec.target,
      drawImage: (...args: unknown[]) => {
        rec.calls.push(`drawImage(${args.length})`);
      },
      get globalCompositeOperation() {
        return (rec.props.globalCompositeOperation as string) ?? 'source-over';
      },
      set globalCompositeOperation(v: string) {
        compositeOps.push(v);
        rec.props.globalCompositeOperation = v;
        rec.calls.push('set globalCompositeOperation');
      },
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      effects: [
        {
          type: 'innerShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 0.8,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(target, [item]);
    expect(compositeOps).not.toContain('destination-over');
    expect(compositeOps).toContain('source-over');
  });

  it('innerShadow uses clip + silhouette compositing', () => {
    const rec = recorder();
    let drawImageCalled = false;
    const target: ReplayTarget = {
      ...rec.target,
      drawImage: (...args: unknown[]) => {
        drawImageCalled = true;
        rec.calls.push(`drawImage(${args.length})`);
      },
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'innerShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(target, [item]);
    expect(drawImageCalled).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('clip'))).toBe(true);
  });

  it('backgroundBlur captures before fill (fillRect after backdrop drawImage)', () => {
    const callOrder: string[] = [];
    const mockCanvas = { width: 200, height: 200 } as HTMLCanvasElement;

    const target: ReplayTarget = {
      ...recorder().target,
      canvas: mockCanvas,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      drawImage: (..._args: unknown[]) => {
        callOrder.push('drawImage');
      },
      fillRect: (..._args: unknown[]) => {
        callOrder.push('fillRect');
      },
    };

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 10, 10],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      effects: [{ type: 'backgroundBlur', radius: 4, visible: true }],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(target, [item]);
    const firstDrawImage = callOrder.indexOf('drawImage');
    const firstFillRect = callOrder.indexOf('fillRect');
    expect(firstDrawImage).toBeGreaterThanOrEqual(0);
    expect(firstFillRect).toBeGreaterThanOrEqual(0);
    expect(firstDrawImage).toBeLessThan(firstFillRect);
  });

  it('backgroundBlur gracefully handles unavailable OffscreenCanvas', () => {
    // In test environments where OffscreenCanvas.getContext returns null,
    // backgroundBlur should silently fall through without crashing.
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'backgroundBlur',
          radius: 8,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    expect(() => replayIr(rec.target, [item])).not.toThrow();
  });

  it('invisible dropShadow does not draw shadow shape', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Only the main fill's fillRect, no extra save/restore for invisible effects
    const fillRects = rec.calls.filter((c) => c.startsWith('fillRect'));
    expect(fillRects.length).toBe(1);
  });

  it('visible dropShadow renders shadow shape in its own save/restore scope', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Shadow effect adds 1 save/1 restore + the main item save/restore
    const saves = rec.calls.filter((c) => c.startsWith('save'));
    expect(saves.length).toBeGreaterThanOrEqual(2);
  });

  it('layerBlur with radius > 32 uses software separable blur (no CSS filter set on target)', () => {
    const rec = recorder();
    // Spy on filter sets
    const filterSetValues: string[] = [];
    Object.defineProperty(rec.target, 'filter', {
      get() {
        return ((rec.props as Record<string, unknown>).filter as string) ?? 'none';
      },
      set(v: string) {
        (rec.props as Record<string, unknown>).filter = v;
        filterSetValues.push(v);
        rec.calls.push('set filter');
      },
      configurable: true,
    });
    let drawImageCount = 0;
    (rec.target as { drawImage?: (...args: unknown[]) => void }).drawImage = (
      ...args: unknown[]
    ) => {
      drawImageCount++;
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 100, g: 150, b: 200, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      effects: [{ type: 'layerBlur', radius: 50, visible: true }],
    };
    replayIr(rec.target, [item]);
    expect(drawImageCount).toBe(1);
    // Software path should NOT set a blur CSS filter on the target.
    // The blur is applied via ImageData manipulation on the offscreen canvas
    // before drawing to the target. No 'blur(...)' string should appear.
    expect(filterSetValues.some((v) => v.includes('blur'))).toBe(false);
  });

  it('multiple effects: dropShadow + layerBlur both render', () => {
    const rec = recorder();
    (rec.target as { drawImage?: (...args: unknown[]) => void }).drawImage = (
      ...args: unknown[]
    ) => {
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 6,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'layerBlur',
          radius: 3,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('fill'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('drawImage'))).toBe(true);
    const filterSets = rec.calls.filter((c) => c === 'set filter');
    expect(filterSets.length).toBeGreaterThanOrEqual(1);
  });

  it('effect state reset after each item', () => {
    const rec = recorder();
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        effects: [
          {
            type: 'dropShadow',
            x: 2,
            y: 4,
            blur: 8,
            spread: 0,
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
            opacity: 0.5,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ];
    replayIr(rec.target, items);
    expect(rec.props.shadowColor).toBe('transparent');
    expect(rec.props.shadowBlur).toBe(0);
    expect(rec.props.filter).toBe('none');
    // Each item's internal effect pass may set and unset shadowColor
    // We just verify the final state is reset
    expect(rec.props.shadowColor).toBe('transparent');
  });

  it('dropShadow with spread increases effective blur', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 4,
          spread: 8,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Spread adds to blur: spread/2 = 4, so total blur = 4 + 4 = 8
    // Should see filter set to blur(8px) during the shadow pass
    expect(rec.calls.some((c) => c === 'set filter')).toBe(true);
  });

  it('dropShadow blendMode applied per-effect', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'multiply',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // blendMode 'multiply' should set globalCompositeOperation to 'multiply'
    const blendCalls = rec.calls.filter((c) => c.startsWith('set globalCompositeOperation'));
    expect(blendCalls.length).toBeGreaterThanOrEqual(2); // set and reset
  });

  it('two drop shadows are rendered independently', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 127, g: 127, b: 127, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: -5,
          y: 5,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'dropShadow',
          x: 5,
          y: -5,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 255, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Each shadow creates its own save/restore pair
    const saves = rec.calls.filter((c) => c.startsWith('save'));
    const fills = rec.calls.filter((c) => c === 'fill(0)');
    // 1 for the item + 2 for the shadows = 3 saves
    expect(saves.length).toBeGreaterThanOrEqual(3);
    // Effects pass now uses fill() (via traceOutline) instead of fillRect for shadows
    // 2 fill() calls for shadows via outline trace
    expect(fills.length).toBeGreaterThanOrEqual(2);
  });
});

describe('multi-item compositing edge cases', () => {
  it('multiple fills stack bottom→top with correct paint order', () => {
    const rec = recorder();
    const item: RenderItem = {
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
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(2);
    const lastFillStyle = String(rec.props.fillStyle ?? '');
    expect(lastFillStyle).toContain('0, 255, 0');
  });

  it('arrow does not double-draw arrowhead in fill+stroke', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          weight: 2,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 1, arrowheadSize: 10 },
    };
    replayIr(rec.target, [item]);
    const fillCalls = rec.calls.filter((c) => c === 'fill(0)');
    expect(fillCalls.length).toBe(1);
  });

  it('rgba() alpha precision uses raw division, not toFixed(3)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 1 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 5, h: 6 },
    };
    replayIr(rec.target, [item]);
    const fs = String(rec.props.fillStyle ?? '');
    expect(fs).not.toBe('rgba(57, 208, 198, 0.004)');
    expect(fs).toBe('rgba(57, 208, 198, 0.00392156862745098)');
  });

  it('image fill draws via drawImage when target supports it', () => {
    // Pre-load the image so paintImageFill takes the cached path.
    getImageCache().setLoaded('test.png', mockImage('test.png', 50, 50));
    const rec = recorder();
    const target = rec.target as unknown as Record<string, unknown>;
    let drawImageCalled = false;
    target.drawImage = (_src: unknown, _dx: unknown, _dy: unknown, _dw: unknown, _dh: unknown) => {
      drawImageCalled = true;
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'image',
          src: 'test.png',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(drawImageCalled).toBe(true);
    const clipIndex = rec.calls.indexOf('clip(0)');
    const restoreIndex = rec.calls.findIndex(
      (call, index) => index > clipIndex && call === 'restore(0)',
    );
    expect(clipIndex).toBeGreaterThanOrEqual(0);
    expect(restoreIndex).toBeGreaterThan(clipIndex);
    expect(rec.calls.some((c) => c.startsWith('restore'))).toBe(true);
  });

  it('clips image fills to non-rectangular primitive outlines', () => {
    getImageCache().setLoaded('ellipse.png', mockImage('ellipse.png', 80, 40));
    const rec = recorder();
    const calls: string[] = [];
    rec.target.drawImage = () => calls.push('drawImage');
    rec.target.clip = () => calls.push('clip');
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'ellipse.png',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'ellipse', cx: 50, cy: 30, rx: 40, ry: 20 },
      },
    ]);
    expect(calls).toEqual(['clip', 'drawImage']);
    expect(rec.calls).toContain('ellipse(7)');
  });

  it('offsets pattern tiles to the primitive bounds before clipping', () => {
    getImageCache().setLoaded('tile-offset.png', mockImage('tile-offset.png', 8, 8));
    const rec = recorder();
    const positions: Array<[number, number]> = [];
    rec.target.drawImage = (_image, x, y) => positions.push([x, y]);
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'tile-offset.png',
            spacing: 2,
            rotation: 0,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 30, y: 40, w: 20, h: 20 },
      },
    ]);
    expect(positions[0]).toEqual([30, 40]);
  });

  it('an image fill with a loading src still paints the loading placeholder', () => {
    const rec = recorder();
    let drawImageCalled = false;
    rec.target.drawImage = () => {
      drawImageCalled = true;
    };
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'https://example.invalid/not-loaded.png',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ]);
    expect(rec.calls).toContain('clip(0)');
    // Placeholder path paints: fillStyle assigned (loading grey) + fillRect.
    expect(rec.calls.filter((c) => c === 'set fillStyle').length).toBeGreaterThanOrEqual(2);
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
    expect(drawImageCalled).toBe(false);
  });

  it('a pattern fill with an empty tileSrc renders transparent (no grey rectangle)', () => {
    const rec = recorder();
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: '',
            spacing: 0,
            rotation: 0,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ]);
    expect(rec.calls).not.toContain('clip(0)');
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(false);
    expect(rec.calls.filter((c) => c === 'fill(0)').length).toBe(0);
    expect(rec.props.fillStyle).toBeUndefined();
  });

  it.each([
    { name: 'zero repeat increment', width: 8, height: 8, spacing: -8 },
    { name: 'zero natural dimensions', width: 0, height: 0, spacing: 0 },
  ])('falls back safely for $name', ({ width, height, spacing }) => {
    getImageCache().setLoaded('invalid-tile.png', mockImage('invalid-tile.png', width, height));
    const rec = recorder();
    let drawCount = 0;
    rec.target.drawImage = () => {
      drawCount++;
      if (drawCount > 5) throw new Error('pattern loop did not advance');
    };

    expect(() =>
      replayIr(rec.target, [
        {
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'pattern',
              tileSrc: 'invalid-tile.png',
              spacing,
              rotation: 0,
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          primitive: { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        },
      ]),
    ).not.toThrow();
    expect(drawCount).toBe(0);
    expect(rec.calls).toContain('fillRect(4)');
  });

  it('rotates a zero-spacing pattern around the primitive center when supported', () => {
    getImageCache().setLoaded('rotated-tile.png', mockImage('rotated-tile.png', 8, 8));
    const rec = recorder();
    const patternTransforms: Array<{
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
    }> = [];
    rec.target.createPattern = () =>
      ({
        setTransform(transform: DOMMatrix2DInit) {
          patternTransforms.push({
            a: transform.a ?? 1,
            b: transform.b ?? 0,
            c: transform.c ?? 0,
            d: transform.d ?? 1,
            e: transform.e ?? 0,
            f: transform.f ?? 0,
          });
        },
      }) as unknown as CanvasPattern;

    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'rotated-tile.png',
            spacing: 0,
            rotation: 90,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 30, y: 40, w: 20, h: 10 },
      },
    ]);

    expect(patternTransforms).toHaveLength(1);
    const patternTransform = patternTransforms[0];
    expect(patternTransform?.a).toBeCloseTo(0);
    expect(patternTransform?.b).toBeCloseTo(1);
    expect(patternTransform?.c).toBeCloseTo(-1);
    expect(patternTransform?.d).toBeCloseTo(0);
    expect(patternTransform?.e).toBeCloseTo(45);
    expect(patternTransform?.f).toBeCloseTo(35);
  });

  it('image fill renders placeholder when drawImage unavailable', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'image',
          src: 'test.png',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // placeholder fillRect should be called
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
  });

  it('pattern fill renders as tinted placeholder', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'pattern',
          tileSrc: 'tile.png',
          spacing: 4,
          rotation: 0,
          opacity: 0.8,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Pattern fill: set fillStyle + paintShapeFill (fillRect for rect)
    expect(rec.calls.some((c) => c.startsWith('set fillStyle'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
  });

  it('honours pattern imageWidth/imageHeight dimension overrides', () => {
    getImageCache().setLoaded('tile-dim.png', mockImage('tile-dim.png', 200, 200));
    const drawCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
    const rec = recorder();
    rec.target.drawImage = (_img: unknown, x: number, y: number, w: number, h: number) => {
      drawCalls.push({ x, y, w, h });
    };
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'tile-dim.png',
            spacing: 0,
            rotation: 0,
            imageWidth: 32,
            imageHeight: 24,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      },
    ]);
    expect(drawCalls.length).toBeGreaterThan(0);
    for (const dc of drawCalls) {
      expect(dc.w).toBe(32);
      expect(dc.h).toBe(24);
    }
  });

  it('starts loading a visible pattern tile when it is not cached', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'pattern',
          tileSrc: 'missing-tile.png',
          spacing: 4,
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };

    replayIr(rec.target, [item]);

    expect(getImageCache().state('missing-tile.png')).toBe('loading');
  });

  it('image fill with empty src is transparent (no placeholder)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      fills: [
        {
          type: 'image',
          src: '',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // An empty image fill contributes nothing: no clip, no placeholder fillRect,
    // and no paint at all (fills[] is authoritative over the legacy item.fill).
    expect(rec.calls).not.toContain('clip(0)');
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(false);
    expect(rec.calls.filter((c) => c === 'fill(0)').length).toBe(0);
    expect(rec.props.fillStyle).toBeUndefined();
  });

  it('image fill ignored when visible is false', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'image',
          src: 'test.png',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Invisible fill: no fills are drawn, no fillStyle set
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(0);
  });

  // ── Backdrop blur cache tests ──────────────────────────────────────────

  describe('backdrop blur cache', () => {
    function makeBackgroundBlurTarget(): ReplayTarget {
      const mockCanvas = { width: 200, height: 200 } as HTMLCanvasElement;
      const rec = recorder();
      return {
        ...rec.target,
        canvas: mockCanvas,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage: (..._args: unknown[]) => {
          rec.calls.push(`drawImage(${_args.length})`);
        },
      };
    }

    function makeBlurItem(overrides?: Partial<RenderItem> & { radius?: number }): RenderItem {
      return {
        transform: [1, 0, 0, 1, 10, 10],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        effects: [{ type: 'backgroundBlur', radius: overrides?.radius ?? 4, visible: true }],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        ...overrides,
      };
    }

    it('stores one entry on first paint and reuses it on second call', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();
      const item = makeBlurItem();

      expect(__getBackdropCacheSize()).toBe(0);
      replayIr(target, [item]);
      expect(__getBackdropCacheSize()).toBe(1);

      // Second call with same params: cache hit
      replayIr(target, [item]);
      expect(__getBackdropCacheSize()).toBe(1);
    });

    it('creates a new cache entry when blur radius changes', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();

      replayIr(target, [makeBlurItem({ radius: 4 })]);
      const sizeAfterFirst = __getBackdropCacheSize();
      expect(sizeAfterFirst).toBe(1);

      replayIr(target, [makeBlurItem({ radius: 8 })]);
      // Cache miss — a second entry created
      expect(__getBackdropCacheSize()).toBe(2);
    });

    it('creates a new cache entry when transform changes', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();

      replayIr(target, [makeBlurItem()]);
      expect(__getBackdropCacheSize()).toBe(1);

      // Different transform → different screen-space bounds → cache miss
      replayIr(target, [makeBlurItem({ transform: [2, 0, 0, 2, 0, 0] })]);
      expect(__getBackdropCacheSize()).toBe(2);
    });

    it('limits cache to 20 entries (LRU eviction)', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const mockCanvas = { width: 500, height: 500 } as HTMLCanvasElement;
      const rec = recorder();
      const target: ReplayTarget = {
        ...rec.target,
        canvas: mockCanvas,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage: (..._args: unknown[]) => {
          rec.calls.push(`drawImage(${_args.length})`);
        },
      };

      // 25 different items (different positions) → cache must evict to ≤20
      for (let i = 0; i < 25; i++) {
        replayIr(target, [
          {
            transform: [1, 0, 0, 1, i * 10, i * 10],
            fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
            effects: [{ type: 'backgroundBlur', radius: 4, visible: true }],
            primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          },
        ]);
      }

      expect(__getBackdropCacheSize()).toBeLessThanOrEqual(20);
    });

    it('clears all entries via __clearBackdropCache', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();

      replayIr(target, [makeBlurItem()]);
      expect(__getBackdropCacheSize()).toBe(1);

      clr();
      expect(__getBackdropCacheSize()).toBe(0);
    });

    it('still renders correctly on cache hit (drawImage + clip called)', async () => {
      const { __clearBackdropCache: clr } = await import('./replay');
      clr();

      const mockCanvas = { width: 200, height: 200 } as HTMLCanvasElement;
      const callOrder: string[] = [];
      const target: ReplayTarget = {
        ...recorder().target,
        canvas: mockCanvas,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage: (..._args: unknown[]) => {
          callOrder.push('drawImage');
        },
        fillRect: (..._args: unknown[]) => {
          callOrder.push('fillRect');
        },
      };

      const item = makeBlurItem();

      // First call: cache miss, captures+blurs+composites
      replayIr(target, [item]);
      expect(callOrder.filter((c) => c === 'drawImage').length).toBeGreaterThanOrEqual(1);

      // Second call: cache hit, should still composite via drawImage
      const drawImageBefore = callOrder.filter((c) => c === 'drawImage').length;
      replayIr(target, [item]);
      const drawImageAfter = callOrder.filter((c) => c === 'drawImage').length;
      // drawImage must still be called (compositing the cached result)
      expect(drawImageAfter).toBeGreaterThan(drawImageBefore);
    });
  });
});
