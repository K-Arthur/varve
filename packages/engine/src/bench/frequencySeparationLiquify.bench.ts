/**
 * CPU baseline for the source-preserving retouch primitives.
 *
 * Run with:
 *   vitest bench --run packages/engine/src/bench/frequencySeparationLiquify.bench.ts
 *
 * These are deliberately real RGBA buffers and a non-identity field. The
 * numbers are a development-machine baseline, not a device guarantee; the
 * audit records the exact runtime and workload separately.
 */
// @vitest-environment node
import { bench, describe } from 'vitest';
import { decomposeFrequencyBands, reconstructFrequencyBands } from '../frequencySeparation';
import { applyLiquifyDab, createLiquifyField } from '../liquify/field';
import { warpImageDataByField } from '../liquify/warp';

interface BenchCase {
  label: string;
  width: number;
  height: number;
}

const CASES: readonly BenchCase[] = [
  { label: 'small', width: 128, height: 96 },
  { label: 'medium', width: 512, height: 384 },
  { label: 'large', width: 1024, height: 768 },
];

function makeFixture(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const checker = (x * 13 + y * 7) % 23 < 11 ? 34 : -24;
      data[offset] = Math.max(0, Math.min(255, 70 + (x * 140) / width + checker));
      data[offset + 1] = Math.max(0, Math.min(255, 45 + (y * 160) / height - checker));
      data[offset + 2] = Math.max(0, Math.min(255, 165 - (x * 80) / width + checker / 2));
      // A transparent edge and soft alpha island exercise the alpha-aware
      // decomposition and premultiplied gather path.
      const edge = x < width * 0.04 || y < height * 0.03;
      const island = Math.hypot(x - width * 0.72, y - height * 0.58) < width * 0.12;
      data[offset + 3] = edge ? 0 : island ? 128 : 255;
    }
  }
  return new ImageData(data, width, height);
}

function makeField(width: number, height: number) {
  const identity = createLiquifyField(width, height);
  return applyLiquifyDab(identity, 'push', {
    x: width * 0.52,
    y: height * 0.5,
    radius: Math.min(width, height) * 0.28,
    strength: 0.55,
    pressure: 1,
    deltaX: width * 0.035,
    deltaY: -height * 0.02,
    dtMs: 16.67,
  });
}

for (const { label, width, height } of CASES) {
  const source = makeFixture(width, height);
  const field = makeField(width, height);
  let bands = decomposeFrequencyBands(source, { radius: 8 });

  describe(`retouch CPU baseline — ${label} ${width}×${height}`, () => {
    bench('frequency separation cold', () => {
      bands = decomposeFrequencyBands(source, { radius: 8 });
    });

    bench('frequency recombination', () => {
      reconstructFrequencyBands(bands.low, bands.high);
    });

    bench('liquify gather warp', () => {
      warpImageDataByField(source, field);
    });
  });
}
