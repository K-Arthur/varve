// @vitest-environment jsdom
import { bench, describe } from 'vitest';
import { applySoftwareFilter } from '../filterCompositor';
import { adjustmentToFilter, makeAdjustment } from '../filters';
import { applySplitTone } from '../splitTone';
import { applyTonalCurves } from '../tonalCurveFilter';
import { applyUnsharpMask } from '../unsharpMask';
import { applyRelativeWhiteBalance } from '../whiteBalance';
import { applyOriginalSplitTone } from './splitToneBaseline';

function source(size: number): ImageData {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4)
    pixels.set([40 + (i % 160), 70 + (i % 110), 100 + (i % 90), 255], i);
  return new ImageData(pixels, size, size);
}
const options = { time: 150, warmupTime: 50, iterations: 3, warmupIterations: 1 };
describe('bounded RGBA8 tonal controls', () => {
  const medium = source(512),
    large = source(1024);
  const curve = adjustmentToFilter(
    makeAdjustment('curve', 'curves', {
      points: [
        { input: 0, output: 0 },
        { input: 77.25, output: 144.75 },
        { input: 255, output: 255 },
      ],
    }),
  );
  const white = makeAdjustment('white', 'whiteBalance', { temperature: 12, tint: -3 });
  const tone = makeAdjustment('tone', 'splitTone', {
    shadowSaturation: 0.18,
    highlightSaturation: 0.15,
  });
  if (curve.kind !== 'curves' || white.kind !== 'whiteBalance' || tone.kind !== 'splitTone')
    throw new Error('factory');
  bench(
    'compiled curves / 1 megapixel',
    () => {
      applyTonalCurves(
        new ImageData(new Uint8ClampedArray(large.data), large.width, large.height),
        curve,
      );
    },
    options,
  );
  bench(
    'relative white balance / 1 megapixel',
    () =>
      applyRelativeWhiteBalance(
        new ImageData(new Uint8ClampedArray(large.data), large.width, large.height),
        white,
      ),
    options,
  );
  bench(
    'Original Oklab split tone / 262k pixels',
    () =>
      applyOriginalSplitTone(
        new ImageData(new Uint8ClampedArray(medium.data), medium.width, medium.height),
        tone,
      ),
    options,
  );
  bench(
    'Oklab split tone / 262k pixels',
    () =>
      applySplitTone(
        new ImageData(new Uint8ClampedArray(medium.data), medium.width, medium.height),
        tone,
      ),
    options,
  );
  for (const radius of [3, 12]) {
    bench(
      `Gaussian linear sharpen r${radius} / 262k pixels`,
      () => {
        applyUnsharpMask(medium, {
          amount: 0.65,
          radius,
          threshold: 0.01,
          luminanceOnly: false,
          protectAlpha: true,
          workingSpace: 'linear-srgb',
        });
      },
      options,
    );
  }
  bench(
    'legacy box sharpen r12 / 262k pixels',
    () => {
      const pixels = new ImageData(new Uint8ClampedArray(medium.data), medium.width, medium.height);
      const ctx = { getImageData: () => pixels, putImageData: () => {} };
      applySoftwareFilter(
        ctx as unknown as CanvasRenderingContext2D,
        adjustmentToFilter(
          makeAdjustment('legacy', 'sharpen', { amount: 65, radius: 12, algorithmVersion: 1 }),
        ),
        pixels.width,
        pixels.height,
      );
    },
    options,
  );
});
