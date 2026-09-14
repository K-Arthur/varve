/**
 * Selection-refinement and matting CPU baseline.
 *
 * Representative bounded cases: a 2048² coverage plane with islands, holes,
 * and a curved boundary for the linear-time plane operations, and a 1024²
 * two-colour edge with a 24-pixel unknown band for the closed-form matting
 * solve. Timings are recorded, not asserted as absolute promises; the checks
 * assert the documented complexity (radius-independent morphology and a
 * bounded solve) rather than a machine-specific duration.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanupPlane,
  gaussianBlurPlane,
  greyMorphPlane,
  signedDistancePlane,
} from '../areaSelectionMorphology';
import { solveMattingLaplacian, TRIMap } from '../backgroundRemoval/mattingSolver';

function coveragePlane(size: number): Uint8Array {
  const plane = new Uint8Array(size * size);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const radius = Math.hypot(dx, dy);
      const value = radius < size * 0.35 ? 255 : radius < size * 0.36 ? 128 : 0;
      plane[y * size + x] = value;
    }
  }
  // A hole and two small islands force the component paths.
  for (let y = cy - 8; y < cy + 8; y += 1) {
    for (let x = cx - 8; x < cx + 8; x += 1) plane[Math.floor(y) * size + Math.floor(x)] = 0;
  }
  for (let i = 0; i < 16; i += 1) plane[(20 + i) * size + 20] = 255;
  for (let i = 0; i < 4; i += 1) plane[(30 + i) * size + 40] = 255;
  return plane;
}

describe('selection refinement CPU baseline', () => {
  it('records plane-operation and matting latency', () => {
    const timings: Record<string, number> = {};
    const size = 2048;
    const plane = coveragePlane(size);

    const time = (key: string, run: () => unknown): void => {
      const started = performance.now();
      run();
      timings[key] = Math.round(performance.now() - started);
    };

    for (const radius of [2, 16, 64]) {
      time(`dilate-r${radius}`, () => greyMorphPlane(plane, size, size, radius, 'dilate'));
    }
    time('feather-sigma2', () => gaussianBlurPlane(plane, size, size, 2));
    time('feather-sigma16', () => gaussianBlurPlane(plane, size, size, 16));
    time('signed-distance', () => signedDistancePlane(plane, size, size));
    time('cleanup', () => cleanupPlane(plane, size, size, { minIslandArea: 64, maxHoleArea: 64 }));

    // Sliding-window morphology is O(N) regardless of radius: the largest
    // radius must stay within a small multiple of the smallest (with a floor
    // for timer noise on fast machines).
    expect(timings['dilate-r64']!).toBeLessThan(Math.max(timings['dilate-r2']! * 4, 250));

    // Closed-form matting over a representative boundary band.
    const matteSize = 1024;
    const source = new Uint8ClampedArray(matteSize * matteSize * 4);
    for (let y = 0; y < matteSize; y += 1) {
      for (let x = 0; x < matteSize; x += 1) {
        const at = (y * matteSize + x) * 4;
        const foreground = x >= matteSize / 2;
        source[at] = foreground ? 220 : 20;
        source[at + 1] = foreground ? 30 : 60;
        source[at + 2] = foreground ? 40 : 220;
        source[at + 3] = 255;
      }
    }
    const trimap = new Uint8Array(matteSize * matteSize);
    for (let y = 0; y < matteSize; y += 1) {
      for (let x = 0; x < matteSize; x += 1) {
        const i = y * matteSize + x;
        trimap[i] =
          x < matteSize / 2 - 12 ? TRIMap.BG : x >= matteSize / 2 + 12 ? TRIMap.FG : TRIMap.UNKNOWN;
      }
    }
    let diagnostics: { iterations: number; relativeResidual: number } | null = null;
    time('matting-band-24px', () => {
      const result = solveMattingLaplacian(
        { data: source, width: matteSize, height: matteSize },
        trimap,
        {
          laplacianRadius: 1,
          maxIterations: 100,
          onDiagnostics: (value) => {
            diagnostics = {
              iterations: value.iterations,
              relativeResidual: value.relativeResidual,
            };
          },
        },
      );
      expect(result).not.toBeNull();
    });
    expect(diagnostics).not.toBeNull();
    timings['matting-iterations'] = diagnostics!.iterations;

    for (const [key, elapsed] of Object.entries(timings)) {
      if (key === 'matting-iterations') continue;
      expect(elapsed, key).toBeLessThan(10_000);
    }
    console.info(`SELECTION_REFINE_BENCH ${JSON.stringify(timings)}`);
  }, 120_000);
});
