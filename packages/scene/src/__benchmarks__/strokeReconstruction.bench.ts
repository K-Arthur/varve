/**
 * Causal brush reconstruction throughput at representative stylus rates.
 *
 * This measures trajectory reconstruction plus arc-length dab generation,
 * not Canvas compositing. Run only this file with:
 *   pnpm vitest bench packages/scene/src/__benchmarks__/strokeReconstruction.bench.ts
 */

import { bench, describe } from 'vitest';
import { defaultBrushPreset, strokePoint } from '../brush';
import { runWholeStroke } from '../strokeEngine';

const preset = {
  ...defaultBrushPreset('bench-reconstruction', 'Reconstruction Bench'),
  radius: 4,
  spacing: 0.25,
  smoothing: 0,
};

function fastSCurve(samples: number) {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / Math.max(1, samples - 1);
    return strokePoint(1_200 * t, 180 * Math.sin(t * Math.PI * 2), {
      pressure: 0.1 + 0.8 * t,
      tilt: 40 * Math.sin(t * Math.PI),
      tiltAzimuth: t * Math.PI * 2,
      time: t * 2_000,
    });
  });
}

describe('causal brush reconstruction', () => {
  for (const rate of [30, 60, 120, 240]) {
    const trace = fastSCurve(rate * 2);
    bench(`${rate}Hz stylus trace (2 seconds)`, () => {
      runWholeStroke(preset, trace, 0x5eed);
    });
  }
});
