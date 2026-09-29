/**
 * Measures the production raster compositor with and without per-gesture
 * opacity tracking at representative canvas sizes. Run with:
 *   pnpm exec vitest bench --run --pool=forks packages/scene/src/__benchmarks__/paintAccumulation.bench.ts
 */

import { bench, describe } from 'vitest';
import { type BrushDab, defaultBrushPreset } from '../brush';
import { compositeDabOnNode, makeRasterLayerNode, TILE_SIZE } from '../rasterLayer';
import { createStrokeOpacityAccumulator } from '../strokeOpacity';

const color = [54, 117, 178, 255] as const;

function makeLine(width: number, height: number): BrushDab[] {
  const preset = defaultBrushPreset('paint-accumulation-bench', 'Paint accumulation bench');
  const step = 4;
  const count = Math.floor(width / step);
  return Array.from({ length: count }, (_, index) => {
    const x = 12 + index * step;
    const t = index / Math.max(1, count - 1);
    return {
      x,
      y: height / 2 + Math.sin(t * Math.PI * 2) * 18,
      radius: 7,
      opacity: 0.42,
      flow: 0.22,
      hardness: 0.55,
      angle: 0,
      roundness: 1,
      strokeT: t,
      strokeDistance: index * step,
      shape: preset.shape,
      blendMode: preset.blendMode,
    };
  });
}

function paint(width: number, accumulation: boolean): void {
  const node = makeRasterLayerNode('bench', { width, height: width });
  const dabs = makeLine(width, width);
  const strokeOpacity = accumulation ? createStrokeOpacityAccumulator(TILE_SIZE * TILE_SIZE) : null;
  let result = node;
  for (const dab of dabs) {
    result = compositeDabOnNode(result, dab, color, strokeOpacity ? { strokeOpacity } : false);
  }
  // Keep the complete composite observable to prevent the benchmark body from
  // becoming a no-op if the compositor is ever optimized lazily.
  if (result.tiles.size === 0) throw new Error('Benchmark stroke did not touch the canvas');
}

describe('raster paint accumulation', () => {
  for (const width of [1_024, 2_048, 4_096]) {
    bench(`${width}px stroke with existing buildup`, () => paint(width, false));
    bench(`${width}px stroke with stroke-opacity tracking`, () => paint(width, true));
  }
});
