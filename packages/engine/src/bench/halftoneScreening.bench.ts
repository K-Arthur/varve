/**
 * Benchmark: halftone screening cost by algorithm, channel count, and
 * resolution. Run with:
 *   pnpm vitest bench --run --config vitest.bench.config.ts \
 *     packages/engine/src/bench/halftoneScreening.bench.ts
 *
 * The benchmark includes per-iteration ImageData allocation so the numbers
 * are a conservative upper bound for a full preview-region re-screen; each
 * case screens a flat mid-gray at a representative ruling.
 */
import { bench, describe } from 'vitest';
import { applyColorHalftoneV2 } from '../colorHalftone';
import type { HalftoneParams } from '../halftone';
import { applyAMScreeningV2, applyLegacyAMScreening, applyOrderedDitherV2 } from '../halftone';

const base: HalftoneParams = {
  pattern: 'dot',
  frequency: 45,
  angle: 45,
  dotShape: 'round',
  channel: 'k',
  method: 'am',
  algorithmVersion: 2,
};

function makeImage(width: number, height: number): ImageData {
  const image = new ImageData(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 128;
    image.data[i + 1] = 128;
    image.data[i + 2] = 128;
    image.data[i + 3] = 255;
  }
  return image;
}

const HD = { width: 1920, height: 1080 };
const SMALL = { width: 640, height: 480 };
const LARGE = { width: 3840, height: 2160 };

describe('halftone AM v2 mono', () => {
  bench('640x480 at 45 LPI', () => {
    applyAMScreeningV2(makeImage(SMALL.width, SMALL.height), base);
  });
  bench('1920x1080 at 45 LPI', () => {
    applyAMScreeningV2(makeImage(HD.width, HD.height), base);
  });
  bench('3840x2160 at 45 LPI', () => {
    applyAMScreeningV2(makeImage(LARGE.width, LARGE.height), base);
  });
});

describe('halftone AM v2 CMYK process', () => {
  bench('1920x1080 at 45 LPI', () => {
    applyAMScreeningV2(makeImage(HD.width, HD.height), {
      ...base,
      channel: 'cmyk',
      blackGeneration: 'gcr',
    });
  });
  bench('1920x1080 at 150 LPI', () => {
    applyAMScreeningV2(makeImage(HD.width, HD.height), {
      ...base,
      frequency: 150,
      channel: 'cmyk',
      blackGeneration: 'gcr',
    });
  });
});

describe('halftone AM v1 legacy (reference)', () => {
  bench('1920x1080 at 45 LPI', () => {
    applyLegacyAMScreening(makeImage(HD.width, HD.height), { ...base, algorithmVersion: 1 });
  });
});

describe('halftone FM ordered v2', () => {
  bench('1920x1080 blue noise', () => {
    applyOrderedDitherV2(
      makeImage(HD.width, HD.height),
      { ...base, method: 'fm', fmAlgorithm: 'blue-noise' },
      'blue-noise',
    );
  });
});

describe('color halftone v2', () => {
  bench('1920x1080 mono', () => {
    applyColorHalftoneV2(makeImage(HD.width, HD.height), {
      screenSize: 16,
      angle: 0,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
    });
  });
  bench('1920x1080 cmyk', () => {
    applyColorHalftoneV2(makeImage(HD.width, HD.height), {
      screenSize: 16,
      angle: 0,
      dotShape: 'round',
      mode: 'cmyk',
      intensity: 1,
    });
  });
});
