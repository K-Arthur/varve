// @vitest-environment jsdom
/**
 * Render-path performance harness — replaySubtreeToCtx / replayIr at scale.
 *
 * IMPORTANT CAVEAT: jsdom's CanvasRenderingContext2D is a no-op stub in this
 * environment (verified directly: `fillRect` draws nothing, `getImageData`
 * always returns zeroed pixels regardless of what was "drawn" — see the
 * capability check run before writing this file). These benchmarks therefore
 * measure the JS-side replay cost only — traversal, transform composition,
 * draw-call *construction and dispatch* — not actual browser rasterization
 * time. That JS-side cost is exactly what a switch-vs-dispatch-table
 * refactor of `replaySubtreeToCtx`/`replayIr` would change, so it's the
 * right thing to benchmark for that purpose, but it is NOT a substitute for
 * a real-browser pixel-paint benchmark (Playwright, wall-clock `rAF` timing)
 * if one is needed for a different question (e.g. actual frame budget /
 * 60fps verification against a GPU/software canvas backend). Flagged as a
 * gap for the visual-regression harness track to pick up if that's in
 * scope there.
 *
 * Run: pnpm vitest run packages/editor/src/canvas/__benchmarks__/renderPath.bench.ts
 * Update baseline: node scripts/audit-render-perf.mjs --update
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createEngine } from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import { SubtreeIrCache } from '../subtreeIrCache';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(THIS_DIR, '../../../../..');

interface SceneNodeLike {
  id: string;
  name: string;
  transform: [number, number, number, number, number, number];
  shape: { kind: 'rect'; x: number; y: number; w: number; h: number };
  fill: { space: 'rgb'; r: number; g: number; b: number; a: number };
  opacity: number;
  blendMode: string;
}

function makeRectNodes(count: number): SceneNodeLike[] {
  const nodes: SceneNodeLike[] = [];
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

/** Keep mock behavior, but do not measure Vitest's growing call-history arrays. */
function withoutCallRecording(ctx: CanvasRenderingContext2D) {
  for (const key of Object.keys(ctx)) {
    const value = Reflect.get(ctx, key);
    if (vi.isMockFunction(value)) {
      Reflect.set(ctx, key, value.getMockImplementation() ?? (() => undefined));
    }
  }
  return ctx;
}

function canvasTarget(canvas: HTMLCanvasElement) {
  const ctx = withoutCallRecording(canvas.getContext('2d')!);
  return {
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    transform: (a0: number, a1: number, a2: number, a3: number, a4: number, a5: number) =>
      ctx.transform(a0, a1, a2, a3, a4, a5),
    clip: () => ctx.clip(),
    translate: (x: number, y: number) => ctx.translate(x, y),
    rotate: (angle: number) => ctx.rotate(angle),
    scale: (x: number, y: number) => ctx.scale(x, y),
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
      if (typeof roundCtx.roundRect === 'function') roundCtx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}
function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

const REPEATED_FRAME_WARMUPS = 2;
// Enough 1% dirty-region samples to touch every cached node once at all tiers.
const INCREMENTAL_FRAME_SAMPLES = 100;

/** Keep the first cold frame visible while timing repeated frame work consistently. */
function measureRepeatedFrames(frame: (index: number) => number, sampleCount: number) {
  const warmupSamplesMs: number[] = [];
  const samplesMs: number[] = [];
  for (let index = -REPEATED_FRAME_WARMUPS; index < sampleCount; index++) {
    const elapsed = frame(index);
    if (index < 0) warmupSamplesMs.push(elapsed);
    else samplesMs.push(elapsed);
  }
  return {
    ...summarize(samplesMs),
    coldSample0Ms: warmupSamplesMs[0]!,
    warmupFrames: REPEATED_FRAME_WARMUPS,
    sampleCount: samplesMs.length,
    warmupSamplesMs,
    samplesMs,
  };
}

const TIERS = [100, 1_000, 10_000, 50_000] as const;
const results: Record<string, unknown> = {
  measuredAt: new Date().toISOString(),
  harness: 'js-dispatch-no-call-history-repeated-frame-warmup',
  nodeVersion: process.version,
  vitestVersion: JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'node_modules/vitest/package.json'), 'utf8'),
  ).version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim(),
  harnessSha256: createHash('sha256')
    .update(readFileSync(new URL(import.meta.url)))
    .digest('hex'),
  tiers: {},
};

/**
 * Fixed-cost control benchmark: a trivial arithmetic loop with no dependency
 * on this codebase's own logic. Its absolute time varies with machine
 * speed/load exactly the way the render-path benchmarks above do — so the
 * *ratio* of a render-path metric to this control stays stable even on a
 * noisy CI runner where absolute wall-clock numbers would not. This is what
 * `scripts/audit-render-perf.mjs --ci` actually gates on, not raw ms.
 */
function controlBenchmark(): number {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 5_000_000; i++) {
    acc += Math.sqrt(i) * 1.0000001;
  }
  if (acc < 0) throw new Error('unreachable — prevents dead-code elimination of the loop');
  return performance.now() - t0;
}

describe('render path perf harness', () => {
  it('preserves mock implementations without recording timed draw calls', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const recordedSave = ctx.save;
    const recordedMeasure = ctx.measureText;
    ctx.font = '18px sans-serif';
    const before = ctx.measureText('Varve');
    withoutCallRecording(ctx);
    ctx.save();
    ctx.fillStyle = '#ff0000';
    expect(ctx.measureText('Varve')).toEqual(before);
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(vi.isMockFunction(ctx.save)).toBe(false);
    expect(vi.isMockFunction(ctx.measureText)).toBe(false);
    expect(recordedSave).not.toHaveBeenCalled();
    expect(recordedMeasure).toHaveBeenCalledTimes(1);
    // A new functional-test context still keeps its ordinary assertions.
    expect(vi.isMockFunction(document.createElement('canvas').getContext('2d')!.save)).toBe(true);
  });

  it('retains draw side effects and readback return values outside timing', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const calls: string[] = [];
    const pixels = new ImageData(3, 2);
    ctx.save = vi.fn(() => calls.push('save'));
    ctx.fillRect = vi.fn((x, y, w, h) => calls.push(`fillRect:${x},${y},${w},${h}`));
    ctx.restore = vi.fn(() => calls.push('restore'));
    ctx.getImageData = vi.fn(() => pixels);
    const recordedDraw = ctx.fillRect;
    withoutCallRecording(ctx);
    ctx.save();
    ctx.fillRect(1, 2, 3, 4);
    ctx.restore();
    expect(ctx.getImageData(0, 0, 3, 2)).toBe(pixels);
    expect(calls).toEqual(['save', 'fillRect:1,2,3,4', 'restore']);
    expect(recordedDraw).not.toHaveBeenCalled();
  });

  it('retains cold frame evidence and excludes exactly two warmups from repeated samples', () => {
    const visits: number[] = [];
    const measured = measureRepeatedFrames((index) => {
      visits.push(index);
      return index < 0 ? 100 : index + 1;
    }, 3);
    expect(visits).toEqual([-2, -1, 0, 1, 2]);
    expect(measured).toEqual({
      p50: 2,
      p95: 3,
      min: 1,
      max: 3,
      coldSample0Ms: 100,
      warmupFrames: 2,
      sampleCount: 3,
      warmupSamplesMs: [100, 100],
      samplesMs: [1, 2, 3],
    });
    // A warmed p50 cannot be presented as a passing cold-frame measurement.
    expect(measured.coldSample0Ms).toBeGreaterThan(measured.max);
  });

  it('executes real dirty-cache invalidation and rebuild for every cold, warm and measured frame', () => {
    const cache = new SubtreeIrCache();
    const item = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      primitive: { kind: 'rect', x: 0, y: 0, w: 20, h: 16 },
    } as Parameters<SubtreeIrCache['set']>[2];
    cache.set('n0', 'initial', item);
    const visited: number[] = [];
    const replayed: unknown[] = [];
    const measured = measureRepeatedFrames((index) => {
      visited.push(index);
      cache.invalidate('n0');
      const hash = `frame-${index}`;
      expect(cache.get('n0', hash)).toBeNull();
      cache.set('n0', hash, item);
      replayed.push(item);
      return 1;
    }, 5);
    expect(visited).toEqual([-2, -1, 0, 1, 2, 3, 4]);
    expect(cache.misses).toBe(7);
    expect(replayed).toHaveLength(7);
    expect(cache.get('n0', 'frame-4')).toBe(item);
    expect(measured.warmupSamplesMs).toEqual([1, 1]);
    expect(measured.samplesMs).toEqual([1, 1, 1, 1, 1]);
  });

  it('control benchmark (fixed-cost, machine-speed baseline)', () => {
    const samples = [controlBenchmark(), controlBenchmark(), controlBenchmark()];
    (results as { control?: unknown }).control = summarize(samples);
    console.log(`[render-perf] control p50=${summarize(samples).p50.toFixed(2)}ms`);
  });

  for (const count of TIERS) {
    it(`${count} nodes — full-frame, incremental, pan/zoom, TTFP, allocations`, async () => {
      const tierResult: Record<string, unknown> = {};

      // Fixture construction cost — reported, not hidden in the other numbers.
      const tFixture0 = performance.now();
      const nodes = makeRectNodes(count);
      const fixtureMs = performance.now() - tFixture0;
      tierResult.fixtureConstructionMs = fixtureMs;

      const eng = await createEngine('stub');
      const ir = await eng.buildIr({
        nodes: nodes as unknown as Parameters<typeof eng.buildIr>[0]['nodes'],
      });
      const { replayIr } = await import('@varve/engine');

      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const target = canvasTarget(canvas);

      // Full-frame render time.
      const iterations = count >= 10_000 ? 3 : 8;
      const fullFrame = measureRepeatedFrames(() => {
        const start = performance.now();
        replayIr(target as Parameters<typeof replayIr>[0], ir as never);
        return performance.now() - start;
      }, iterations);
      tierResult.fullFrame = fullFrame;
      tierResult.coldFullFrame = { sample0Ms: fullFrame.coldSample0Ms };

      // Incremental-frame time via SubtreeIrCache: populate the full tree's
      // IR into the cache once (cold), then simulate a small dirty region
      // (~1% of nodes) by invalidating + recomputing just those entries and
      // replaying just that subset — the real cost a dirty-region redraw
      // would pay, vs. replaying the whole tree.
      const cache = new SubtreeIrCache();
      const irArray = ir as unknown as unknown[];
      for (let i = 0; i < nodes.length && i < irArray.length; i++) {
        const seedNode = nodes[i];
        if (!seedNode) continue;
        cache.set(seedNode.id, `v0-${seedNode.id}`, irArray[i] as never);
      }
      const dirtyCount = Math.max(1, Math.floor(count * 0.01));
      const incrementalFrame = measureRepeatedFrames((sampleIndex) => {
        const start = performance.now();
        // Warmups perform the same invalidate/miss/rebuild/replay work on
        // the first dirty region; measured regions retain their old indices.
        const i = Math.max(0, sampleIndex);
        const dirtyItems: unknown[] = [];
        for (let d = 0; d < dirtyCount; d++) {
          const idx = (i * dirtyCount + d) % nodes.length;
          const node = nodes[idx];
          if (!node) continue;
          cache.invalidate(node.id);
          const newHash = `v${i + 1}-${node.id}`;
          let item = cache.get(node.id, newHash);
          if (!item) {
            item = irArray[idx] as never; // recompute stand-in: reuse the built IR item
            cache.set(node.id, newHash, item as never);
          }
          dirtyItems.push(item);
        }
        replayIr(target as Parameters<typeof replayIr>[0], dirtyItems as never);
        return performance.now() - start;
      }, INCREMENTAL_FRAME_SAMPLES);
      tierResult.incrementalFrame = {
        ...incrementalFrame,
        dirtyNodeCount: dirtyCount,
        dirtyFraction: 0.01,
      };
      // This remains explicit cold-path evidence; warmed ratios do not
      // certify the cold sample or replace the separate TTFP measurement.
      tierResult.coldIncrementalFrame = { sample0Ms: incrementalFrame.coldSample0Ms };

      // Pan/zoom frame time: repeated replay under a changing camera transform.
      const panZoomFrame = measureRepeatedFrames(
        (sampleIndex) => {
          const i = Math.max(0, sampleIndex);
          const zoom = 1 + i * 0.1;
          const panX = i * 15;
          target.save();
          target.transform(zoom, 0, 0, zoom, panX, 0);
          // Preserve the existing measured boundary: replay only, with camera
          // setup/restore executed for every warm and measured frame.
          const start = performance.now();
          replayIr(target as Parameters<typeof replayIr>[0], ir as never);
          const elapsed = performance.now() - start;
          target.restore();
          return elapsed;
        },
        Math.min(iterations, 5),
      );
      tierResult.panZoomFrame = panZoomFrame;
      tierResult.coldPanZoomFrame = { sample0Ms: panZoomFrame.coldSample0Ms };

      // Time to first paint: fresh nodes -> IR -> first replay, end to end.
      const ttfpSamples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const freshNodes = makeRectNodes(count);
        const freshEng = await createEngine('stub');
        const freshIr = await freshEng.buildIr({
          nodes: freshNodes as unknown as Parameters<typeof freshEng.buildIr>[0]['nodes'],
        });
        const freshCanvas = document.createElement('canvas');
        freshCanvas.width = 1920;
        freshCanvas.height = 1080;
        const freshTarget = canvasTarget(freshCanvas);
        replayIr(freshTarget as Parameters<typeof replayIr>[0], freshIr as never);
        ttfpSamples.push(performance.now() - t0);
      }
      tierResult.timeToFirstPaint = summarize(ttfpSamples);

      // Allocation / GC pressure proxy: heap growth over a batch of frames.
      // No --expose-gc in the standard vitest run, so this is heap-growth
      // under load, not a true pre/post-GC delta — stated plainly as an
      // approximation, not forced-GC precision.
      const heapBefore = process.memoryUsage().heapUsed;
      for (let i = 0; i < 20; i++) {
        replayIr(target as Parameters<typeof replayIr>[0], ir as never);
      }
      const heapAfter = process.memoryUsage().heapUsed;
      tierResult.heapGrowthOver20FramesBytes = heapAfter - heapBefore;
      tierResult.heapGrowthPerFrameBytesApprox = (heapAfter - heapBefore) / 20;

      (results.tiers as Record<string, unknown>)[String(count)] = tierResult;

      console.log(
        `[render-perf] ${count} nodes: fixture=${fixtureMs.toFixed(1)}ms full-frame p50=${(tierResult.fullFrame as ReturnType<typeof summarize>).p50.toFixed(2)}ms p95=${(tierResult.fullFrame as ReturnType<typeof summarize>).p95.toFixed(2)}ms`,
      );
    }, 120_000);
  }

  it('writes results to .render-perf-results.json', () => {
    writeFileSync(
      path.join(REPO_ROOT, '.render-perf-results.json'),
      `${JSON.stringify(results, null, 2)}\n`,
    );
  });
});
