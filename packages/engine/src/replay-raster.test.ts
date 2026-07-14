/**
 * Tests for rasterLayer primitive rendering in the engine pipeline.
 */
import { describe, expect, it } from 'vitest';
import type { ReplayTarget } from './replay';
import { primitiveBounds, replayIr } from './replay';
import type { EngineRasterLayerPrimitive, RenderItem, SceneNode } from './types';

const TILE = 128;

function makeTile(
  _col: number,
  _row: number,
  fillR = 255,
  fillG = 0,
  fillB = 0,
): {
  pixels: number[];
  version: number;
} {
  const pixels = new Array<number>(TILE * TILE * 4).fill(0);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const idx = (y * TILE + x) * 4;
      pixels[idx] = fillR;
      pixels[idx + 1] = fillG;
      pixels[idx + 2] = fillB;
      pixels[idx + 3] = 255;
    }
  }
  return { pixels, version: 1 };
}

function makeRecorder(): {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
} {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const mk =
    (k: string) =>
    (..._args: unknown[]) =>
      calls.push(`${k}(${_args.length})`);
  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    clip: mk('clip'),
    transform: mk('transform'),
    fillRect: mk('fillRect'),
    beginPath: mk('beginPath'),
    rect: mk('rect'),
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
    drawImage: mk('drawImage'),

    get fillStyle() {
      return (props.fillStyle as string) ?? '';
    },
    set fillStyle(v) {
      props.fillStyle = v;
      calls.push('set fillStyle');
    },
    get globalAlpha() {
      return (props.globalAlpha as number) ?? 1;
    },
    set globalAlpha(v) {
      props.globalAlpha = v;
      calls.push('set globalAlpha');
    },
    get globalCompositeOperation() {
      return (props.globalCompositeOperation as string) ?? 'source-over';
    },
    set globalCompositeOperation(v) {
      props.globalCompositeOperation = v;
      calls.push('set globalCompositeOperation');
    },
    get filter() {
      return (props.filter as string) ?? 'none';
    },
    set filter(v) {
      props.filter = v;
      calls.push('set filter');
    },
    get shadowColor() {
      return (props.shadowColor as string) ?? 'transparent';
    },
    set shadowColor(v) {
      props.shadowColor = v;
      calls.push('set shadowColor');
    },
    get shadowBlur() {
      return (props.shadowBlur as number) ?? 0;
    },
    set shadowBlur(v) {
      props.shadowBlur = v;
      calls.push('set shadowBlur');
    },
    get shadowOffsetX() {
      return (props.shadowOffsetX as number) ?? 0;
    },
    set shadowOffsetX(v) {
      props.shadowOffsetX = v;
      calls.push('set shadowOffsetX');
    },
    get shadowOffsetY() {
      return (props.shadowOffsetY as number) ?? 0;
    },
    set shadowOffsetY(v) {
      props.shadowOffsetY = v;
      calls.push('set shadowOffsetY');
    },
    get lineWidth() {
      return (props.lineWidth as number) ?? 0;
    },
    set lineWidth(v) {
      props.lineWidth = v;
      calls.push('set lineWidth');
    },
    get lineCap() {
      return (props.lineCap as CanvasLineCap) ?? 'butt';
    },
    set lineCap(v) {
      props.lineCap = v;
      calls.push('set lineCap');
    },
    get strokeStyle() {
      return (props.strokeStyle as string) ?? '';
    },
    set strokeStyle(v) {
      props.strokeStyle = v;
      calls.push('set strokeStyle');
    },
    get lineJoin() {
      return (props.lineJoin as CanvasLineJoin) ?? 'miter';
    },
    set lineJoin(v) {
      props.lineJoin = v;
      calls.push('set lineJoin');
    },
    get font() {
      return (props.font as string) ?? '10px sans-serif';
    },
    set font(v) {
      props.font = v;
      calls.push('set font');
    },
    get textAlign() {
      return (props.textAlign as CanvasTextAlign) ?? 'left';
    },
    set textAlign(v) {
      props.textAlign = v;
      calls.push('set textAlign');
    },
    get textBaseline() {
      return (props.textBaseline as string) ?? 'alphabetic';
    },
    set textBaseline(v) {
      props.textBaseline = v;
      calls.push('set textBaseline');
    },
    get lineDashOffset() {
      return (props.lineDashOffset as number) ?? 0;
    },
    set lineDashOffset(v) {
      props.lineDashOffset = v;
      calls.push('set lineDashOffset');
    },
  };
  return { target: target as unknown as ReplayTarget, calls, props };
}

describe('primitiveBounds – rasterLayer', () => {
  it('returns correct dimensions', () => {
    const p: EngineRasterLayerPrimitive = {
      kind: 'rasterLayer',
      width: 640,
      height: 480,
      pixelMode: false,
      tiles: {},
    };
    const bounds = primitiveBounds(p);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.w).toBe(640);
    expect(bounds.h).toBe(480);
  });

  it('handles zero dimensions', () => {
    const p: EngineRasterLayerPrimitive = {
      kind: 'rasterLayer',
      width: 0,
      height: 0,
      pixelMode: false,
      tiles: {},
    };
    const bounds = primitiveBounds(p);
    expect(bounds.w).toBe(0);
    expect(bounds.h).toBe(0);
  });
});

describe('replayIr – rasterLayer', () => {
  it('calls drawImage for rasterLayer item', () => {
    const { target, calls } = makeRecorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      primitive: {
        kind: 'rasterLayer',
        width: 256,
        height: 256,
        pixelMode: false,
        tiles: {
          '0:0': makeTile(0, 0, 100, 150, 200),
          '1:0': makeTile(1, 0, 200, 100, 50),
        },
      },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
    };

    replayIr(target, [item]);

    // save/restore pair + drawImage call
    const drawImageCalls = calls.filter((c) => c.startsWith('drawImage'));
    expect(drawImageCalls.length).toBe(1);
    expect(calls.filter((c) => c.startsWith('save')).length).toBe(1);
    expect(calls.filter((c) => c.startsWith('restore')).length).toBe(1);
  });

  it('renders rasterLayer with opacity and blendMode', () => {
    const { target, calls } = makeRecorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 10, 20] as const,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      primitive: {
        kind: 'rasterLayer',
        width: 128,
        height: 128,
        pixelMode: true,
        tiles: { '0:0': makeTile(0, 0, 255, 0, 0) },
      },
      opacity: 0.5,
      blendMode: 'multiply',
      strokes: [],
      effects: [],
    };

    replayIr(target, [item]);

    const alphaCalls = calls.filter((c) => c === 'set globalAlpha');
    const blendCalls = calls.filter((c) => c === 'set globalCompositeOperation');
    const transformCalls = calls.filter((c) => c.startsWith('transform'));

    expect(alphaCalls.length).toBeGreaterThanOrEqual(1);
    expect(blendCalls.length).toBeGreaterThanOrEqual(1);
    expect(transformCalls.length).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.startsWith('drawImage'))).toBe(true);
  });
});

describe('stub engine buildIr – rasterLayer', () => {
  it('produces rasterLayer primitive from rasterLayerData', async () => {
    // Dynamic import to avoid circular dep in the test mock env
    const { createEngine } = await import('./engine');
    const eng = await createEngine('stub');

    const node: SceneNode = {
      id: 'rl-1',
      name: 'Raster Layer 1',
      transform: [1, 0, 0, 1, 0, 0] as const,
      kind: 'rasterLayer',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
      rasterLayerData: {
        width: 640,
        height: 480,
        pixelMode: false,
        tiles: {
          '0:0': { pixels: new Array(65536).fill(0), version: 1 },
        },
      },
    };

    const ir = await eng.buildIr({ nodes: [node] });
    expect(ir.length).toBe(1);
    const prim = ir[0]!.primitive;
    expect(prim.kind).toBe('rasterLayer');
    if (prim.kind === 'rasterLayer') {
      expect(prim.width).toBe(640);
      expect(prim.height).toBe(480);
      expect(prim.pixelMode).toBe(false);
      expect(Object.keys(prim.tiles).length).toBe(1);
      expect(prim.tiles['0:0']).toBeDefined();
    }
  });
});
