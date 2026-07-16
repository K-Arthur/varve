// @vitest-environment jsdom
/**
 * Replay performance microbenchmark — records p50/p95 frame time and IR size.
 * Run: pnpm bench:canvas
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import { replayIr } from '../replay';
import type { RenderItem, SceneNode } from '../types';
import { estimateIrBytes, summarize, warmUp } from './benchUtils';

function makeRectNodes(count: number): SceneNode[] {
  const nodes: SceneNode[] = [];
  const cols = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodes.push({
      id: `n-${i}`,
      name: `Rect ${i}`,
      transform: [1, 0, 0, 1, col * 24, row * 24],
      shape: { kind: 'rect', x: 0, y: 0, w: 20, h: 16 },
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
    });
  }
  return nodes;
}

function canvasTarget(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  return {
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    transform: (a0: number, a1: number, a2: number, a3: number, a4: number, a5: number) =>
      ctx.transform(a0, a1, a2, a3, a4, a5),
    clip: () => ctx.clip(),
    translate: (x: number, y: number) => ctx.translate(x, y),
    rotate: (angle: number) => ctx.rotate(angle),
    fillRect: (x: number, y: number, w: number, h: number) => ctx.fillRect(x, y, w, h),
    strokeRect: (x: number, y: number, w: number, h: number) => ctx.strokeRect(x, y, w, h),
    beginPath: () => ctx.beginPath(),
    rect: (x: number, y: number, w: number, h: number) => ctx.rect(x, y, w, h),
    ellipse: (x: number, y: number, rx: number, ry: number) =>
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2),
    arc: (x: number, y: number, r: number, s: number, e: number) => ctx.arc(x, y, r, s, e),
    moveTo: (x: number, y: number) => ctx.moveTo(x, y),
    lineTo: (x: number, y: number) => ctx.lineTo(x, y),
    bezierCurveTo: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      ctx.bezierCurveTo(a, b, c, d, e, f),
    fill: () => ctx.fill(),
    stroke: () => ctx.stroke(),
    closePath: () => ctx.closePath(),
    setLineDash: (d: number[]) => ctx.setLineDash(d),
    roundRect: (x: number, y: number, w: number, h: number, r: number) => {
      const roundCtx = ctx as CanvasRenderingContext2D & {
        roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
      };
      if (typeof roundCtx.roundRect === 'function') {
        roundCtx.roundRect(x, y, w, h, r);
      } else {
        ctx.rect(x, y, w, h);
      }
    },
    fillText: (t: string, x: number, y: number) => ctx.fillText(t, x, y),
    get fillStyle() {
      return ctx.fillStyle;
    },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      ctx.fillStyle = v;
    },
    get strokeStyle() {
      return ctx.strokeStyle;
    },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
      ctx.strokeStyle = v;
    },
    get lineWidth() {
      return ctx.lineWidth;
    },
    set lineWidth(v: number) {
      ctx.lineWidth = v;
    },
    get lineCap() {
      return ctx.lineCap;
    },
    set lineCap(v: CanvasLineCap) {
      ctx.lineCap = v;
    },
    get lineJoin() {
      return ctx.lineJoin;
    },
    set lineJoin(v: CanvasLineJoin) {
      ctx.lineJoin = v;
    },
    get globalAlpha() {
      return ctx.globalAlpha;
    },
    set globalAlpha(v: number) {
      ctx.globalAlpha = v;
    },
    get globalCompositeOperation() {
      return ctx.globalCompositeOperation;
    },
    set globalCompositeOperation(v: GlobalCompositeOperation) {
      ctx.globalCompositeOperation = v;
    },
    get font() {
      return ctx.font;
    },
    set font(v: string) {
      ctx.font = v;
    },
    get textBaseline() {
      return ctx.textBaseline;
    },
    set textBaseline(v: CanvasTextBaseline) {
      ctx.textBaseline = v;
    },
    get textAlign() {
      return ctx.textAlign;
    },
    set textAlign(v: CanvasTextAlign) {
      ctx.textAlign = v;
    },
    get lineDashOffset() {
      return ctx.lineDashOffset;
    },
    set lineDashOffset(v: number) {
      ctx.lineDashOffset = v;
    },
    get filter() {
      return ctx.filter;
    },
    set filter(v: string) {
      ctx.filter = v;
    },
  };
}

async function benchReplay(
  count: number,
  iterations = 5,
): Promise<{ replay: ReturnType<typeof summarize>; irBytes: number }> {
  const eng = await createEngine('stub');
  const nodes = makeRectNodes(count);
  const ir = await eng.buildIr({ nodes });
  const irBytes = estimateIrBytes(ir);

  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 600;
  const target = canvasTarget(canvas);

  warmUp(() => replayIr(target as Parameters<typeof replayIr>[0], ir as RenderItem[]));

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    replayIr(target as Parameters<typeof replayIr>[0], ir as RenderItem[]);
    samples.push(performance.now() - t0);
  }

  return { replay: summarize(samples), irBytes };
}

describe('replay bench', () => {
  it('100 rects — replay under 50ms p95', async () => {
    const { replay, irBytes } = await benchReplay(100);
    console.log(
      `canvas-bench 100 rects p50=${replay.p50.toFixed(2)}ms p95=${replay.p95.toFixed(2)}ms ir=${irBytes}B`,
    );
    expect(replay.p95).toBeLessThan(50);
    expect(irBytes).toBeGreaterThan(0);
  }, 30_000);

  it('1000 rects — replay under 500ms p95', async () => {
    const { replay } = await benchReplay(1000, 3);
    console.log(
      `canvas-bench 1000 rects p50=${replay.p50.toFixed(2)}ms p95=${replay.p95.toFixed(2)}ms`,
    );
    expect(replay.p95).toBeLessThan(500);
  }, 60_000);

  it('IR size scales roughly linearly with node count', async () => {
    const eng = await createEngine('stub');
    const small = await eng.buildIr({ nodes: makeRectNodes(10) });
    const large = await eng.buildIr({ nodes: makeRectNodes(100) });
    const smallBytes = estimateIrBytes(small);
    const largeBytes = estimateIrBytes(large);
    expect(largeBytes).toBeGreaterThan(smallBytes * 5);
  });
});
