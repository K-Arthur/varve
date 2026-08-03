/**
 * Measurement-only tests for full-layer raster reconstruction, plus the
 * decision gate that governs whether the path may be replaced.
 *
 * Per the raster tiling decision record, no optimization ships before the
 * trigger below is met on a representative workload.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIRTY_TILE_SHARE_THRESHOLD,
  evaluateRasterTrigger,
  INTERMEDIATE_BYTES_THRESHOLD,
  isRasterReplayMeasured,
  RasterReplayRecorder,
  RENDER_SHARE_THRESHOLD,
  setRasterReplaySink,
} from './rasterReplayMetrics';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { EngineRasterLayerPrimitive, RenderItem } from './types';

const TILE = 128;

function tiles(cols: number, rows: number): EngineRasterLayerPrimitive['tiles'] {
  const out: EngineRasterLayerPrimitive['tiles'] = {};
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      out[`${col}:${row}`] = { pixels: new Array(TILE * TILE * 4).fill(0), version: 1 };
    }
  }
  return out;
}

function rasterItem(cols: number, rows: number): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    primitive: {
      kind: 'rasterLayer',
      width: cols * TILE,
      height: rows * TILE,
      pixelMode: false,
      tiles: tiles(cols, rows),
    },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  } as RenderItem;
}

/**
 * Replay target that accepts every 2D call and yields a usable offscreen
 * context, so reconstruction runs end to end rather than bailing early.
 */
function target(): ReplayTarget {
  const noop = () => undefined;
  const base: Record<string, unknown> = {
    drawImage: noop,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    getContext: () => base,
  };
  return new Proxy(base, {
    get: (obj, key) => (key in obj ? Reflect.get(obj, key) : noop),
    set: (obj, key, value) => {
      Reflect.set(obj, key, value);
      return true;
    },
  }) as unknown as ReplayTarget;
}

describe('raster replay measurement', () => {
  afterEach(() => setRasterReplaySink(null));

  it('is disabled by default so the untraced path is unchanged', () => {
    expect(isRasterReplayMeasured()).toBe(false);
  });

  it('records reconstruction cost and the full-layer intermediate size', () => {
    const recorder = new RasterReplayRecorder();
    setRasterReplaySink(recorder.sink);
    const t = target();
    replayIr(t, [rasterItem(4, 4)], () => undefined);

    const sample = recorder.all[0];
    expect(sample).toBeDefined();
    expect(sample?.totalTiles).toBe(16);
    expect(sample?.compositedTiles).toBe(16);
    // The intermediate is the *whole layer*, regardless of how much changed.
    expect(sample?.intermediateBytes).toBe(512 * 512 * 4);
    expect(sample?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('composites every tile even when only one changed', () => {
    const recorder = new RasterReplayRecorder();
    setRasterReplaySink(recorder.sink);
    const item = rasterItem(8, 8);
    // Bump one tile's version — the model's unit of change.
    const primitive = item.primitive as EngineRasterLayerPrimitive;
    primitive.tiles['0:0'] = { pixels: primitive.tiles['0:0']!.pixels, version: 2 };
    replayIr(target(), [item], () => undefined);

    // This is the measured claim behind the decision record: reconstruction
    // cost is O(all tiles), not O(changed tiles).
    expect(recorder.all[0]?.compositedTiles).toBe(64);
  });

  it('scales reconstruction work linearly with tile count', () => {
    const recorder = new RasterReplayRecorder();
    setRasterReplaySink(recorder.sink);
    replayIr(target(), [rasterItem(2, 2)], () => undefined);
    replayIr(target(), [rasterItem(8, 8)], () => undefined);

    const [small, large] = recorder.all;
    expect(small?.compositedTiles).toBe(4);
    expect(large?.compositedTiles).toBe(64);
    expect(large!.intermediateBytes / small!.intermediateBytes).toBe(16);
  });

  it('bounds retention over a long session', () => {
    const recorder = new RasterReplayRecorder();
    for (let i = 0; i < RasterReplayRecorder.MAX_SAMPLES + 50; i++) {
      recorder.sink({
        width: 1,
        height: 1,
        totalTiles: 1,
        compositedTiles: 1,
        intermediateBytes: 4,
        surfaceMs: 0,
        tileReplayMs: 0,
        drawMs: 0,
        totalMs: 0,
      });
    }
    expect(recorder.all).toHaveLength(RasterReplayRecorder.MAX_SAMPLES);
  });

  it('summarizes nothing without samples', () => {
    expect(new RasterReplayRecorder().summary()).toBeNull();
  });
});

describe('raster optimization trigger', () => {
  const belowThreshold = {
    p95ReconstructionMs: 1.2,
    shareOfRenderTime: 0.05,
    dirtyTileShare: 0.9,
    maxIntermediateBytes: 1024 * 1024,
    frameBudgetMs: 16.7,
  };

  it('is not met by a cheap layer', () => {
    expect(evaluateRasterTrigger(belowThreshold)).toEqual({ met: false, reasons: [] });
  });

  it('is met when reconstruction exceeds the frame budget', () => {
    const result = evaluateRasterTrigger({ ...belowThreshold, p95ReconstructionMs: 20 });
    expect(result.met).toBe(true);
    expect(result.reasons[0]).toContain('frame budget');
  });

  it('is met when reconstruction owns a material share of render time', () => {
    const result = evaluateRasterTrigger({
      ...belowThreshold,
      shareOfRenderTime: RENDER_SHARE_THRESHOLD + 0.01,
    });
    expect(result.met).toBe(true);
    expect(result.reasons.join(' ')).toContain('% of render time');
  });

  it('is met when a large intermediate is allocated', () => {
    const result = evaluateRasterTrigger({
      ...belowThreshold,
      maxIntermediateBytes: INTERMEDIATE_BYTES_THRESHOLD + 1,
    });
    expect(result.met).toBe(true);
    expect(result.reasons.join(' ')).toContain('intermediate surface');
  });

  it('ignores a low dirty-tile share on a layer that is cheap anyway', () => {
    // Wasted work only matters when there is enough of it to be worth saving;
    // otherwise this would trigger a hot-path rewrite for nothing.
    const result = evaluateRasterTrigger({
      ...belowThreshold,
      dirtyTileShare: DIRTY_TILE_SHARE_THRESHOLD - 0.1,
    });
    expect(result.met).toBe(false);
  });

  it('is met by a low dirty-tile share on an expensive layer', () => {
    const result = evaluateRasterTrigger({
      ...belowThreshold,
      dirtyTileShare: DIRTY_TILE_SHARE_THRESHOLD - 0.1,
      p95ReconstructionMs: 12,
    });
    expect(result.met).toBe(true);
    expect(result.reasons.join(' ')).toContain('intersect the dirty region');
  });
});
