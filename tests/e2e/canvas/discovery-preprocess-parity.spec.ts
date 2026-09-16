import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Browser preprocessing parity for the discovery path (G5).
 *
 * The Node real-model gate validates one preprocessing path
 * (`buildGroundingDinoInputs`, which resizes in JS), while the browser panel
 * uses a different one (`buildGroundingDinoInputsFromModelImage`, which
 * normalizes an image the browser already drew at 800x800). Nothing has
 * verified that the shipped browser path produces model inputs comparable to
 * the validated reference.
 *
 * This probe loads both *real engine functions* from the app's own module
 * graph (through Vite's `/@fs/` source route, so it is the shipped code, not a
 * reimplementation), runs them on the same real photograph, and compares the
 * resulting `pixel_values` tensors.
 *
 * It measures preprocessing parity, NOT detection parity: without the 2.4 GB
 * detector there is no detection to compare. The label on the evidence says so.
 *
 * Enable with VARVE_PREPROCESS_PARITY_PROBE=1.
 */

const enabled = process.env.VARVE_PREPROCESS_PARITY_PROBE === '1';
// `/@fs/` because the dev server's root is apps/desktop; the workspace fixture
// is outside it, and a plain path would return the SPA fallback HTML.
const FIXTURE =
  process.env.VARVE_PREPROCESS_PARITY_FIXTURE ??
  `/@fs${path.resolve('tests/e2e/fixtures/real-life-elephant.jpg')}`;
const ENGINE_MODULE =
  process.env.VARVE_PREPROCESS_PARITY_MODULE ??
  `/@fs${path.resolve('packages/engine/src/discovery/groundingDino.ts')}`;

interface ParityResult {
  fixture: string;
  sourceWidth: number;
  sourceHeight: number;
  shapes: { reference: number[]; browser: number[] };
  stats: {
    meanAbsDiff: number;
    maxAbsDiff: number;
    p99AbsDiff: number;
    fractionAbove0_05: number;
    referenceChannelMeans: number[];
    browserChannelMeans: number[];
  };
  antialiasing: {
    referenceVsBoxAverage: { meanAbsDiff: number; p99AbsDiff: number };
    browserVsBoxAverage: { meanAbsDiff: number; p99AbsDiff: number };
  };
  notes: string[];
}

test.describe('discovery preprocessing parity', () => {
  test.skip(
    !enabled,
    'Set VARVE_PREPROCESS_PARITY_PROBE=1 (loads the app dev server and runs both preprocessing paths in the page)',
  );

  test('compares the shipped browser preprocessing with the validated reference', async ({
    page,
  }, testInfo) => {
    test.setTimeout(5 * 60_000);
    // A minimal document keeps the probe independent of the editor bundle.
    await page.route('**/probe.html', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>preprocess parity</title></head><body></body></html>',
      }),
    );
    await page.goto('/probe.html', { timeout: 30_000 });

    const result = (await page.evaluate(
      async ({ fixture, engineModule }) => {
        const engine = (await import(/* @vite-ignore */ engineModule)) as {
          buildGroundingDinoInputs: (
            image: { data: Uint8ClampedArray; width: number; height: number },
            tokenization: unknown,
          ) => { pixel_values: { data: Float32Array; dims: number[] } };
          buildGroundingDinoInputsFromModelImage: (
            image: { data: Uint8ClampedArray; width: number; height: number },
            tokenization: unknown,
          ) => { pixel_values: { data: Float32Array; dims: number[] } };
        };
        const response = await fetch(fixture, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`fixture fetch failed: ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());

        // Reference path: full-resolution pixels, JS resize (what the Node gate used).
        const referenceCanvas = document.createElement('canvas');
        referenceCanvas.width = bitmap.width;
        referenceCanvas.height = bitmap.height;
        const referenceCtx = referenceCanvas.getContext('2d');
        if (!referenceCtx) throw new Error('no 2d context for the reference path');
        referenceCtx.drawImage(bitmap, 0, 0);
        const referenceImage = referenceCtx.getImageData(0, 0, bitmap.width, bitmap.height);

        // Shipped browser path: draw straight to 800x800, then normalize.
        const modelCanvas = document.createElement('canvas');
        modelCanvas.width = 800;
        modelCanvas.height = 800;
        const modelCtx = modelCanvas.getContext('2d');
        if (!modelCtx) throw new Error('no 2d context for the model path');
        modelCtx.imageSmoothingEnabled = true;
        modelCtx.imageSmoothingQuality = 'high';
        modelCtx.drawImage(bitmap, 0, 0, 800, 800);
        const modelImage = modelCtx.getImageData(0, 0, 800, 800);

        /**
         * Area-average resize, computed independently in the page. This is the
         * reference for "antialiased downscale": whichever path is closer to it
         * is the better approximation of the reference processor's documented
         * antialiased resize. Comparing the two paths to each other alone would
         * only say they differ, not which one is closer.
         */
        const boxAverage = new ImageData(new Uint8ClampedArray(800 * 800 * 4), 800, 800);
        const scaleX = bitmap.width / 800;
        const scaleY = bitmap.height / 800;
        for (let y = 0; y < 800; y += 1) {
          const y0 = Math.floor(y * scaleY);
          const y1 = Math.min(bitmap.height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)));
          for (let x = 0; x < 800; x += 1) {
            const x0 = Math.floor(x * scaleX);
            const x1 = Math.min(bitmap.width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)));
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;
            for (let sy = y0; sy < y1; sy += 1) {
              for (let sx = x0; sx < x1; sx += 1) {
                const at = (sy * bitmap.width + sx) * 4;
                r += referenceImage.data[at] ?? 0;
                g += referenceImage.data[at + 1] ?? 0;
                b += referenceImage.data[at + 2] ?? 0;
                count += 1;
              }
            }
            const to = (y * 800 + x) * 4;
            boxAverage.data[to] = r / count;
            boxAverage.data[to + 1] = g / count;
            boxAverage.data[to + 2] = b / count;
            boxAverage.data[to + 3] = 255;
          }
        }

        // Only `ids` is read by the input builder for the pixel path.
        const tokenization = { ids: [101, 102] };
        const reference = engine.buildGroundingDinoInputs(referenceImage, tokenization);
        const browser = engine.buildGroundingDinoInputsFromModelImage(modelImage, tokenization);
        const boxReference = engine.buildGroundingDinoInputsFromModelImage(
          boxAverage,
          tokenization,
        );
        const left = reference.pixel_values.data;
        const right = browser.pixel_values.data;
        const box = boxReference.pixel_values.data;
        if (left.length !== right.length) {
          throw new Error(`tensor length mismatch: ${left.length} vs ${right.length}`);
        }
        const compare = (a: Float32Array, b: Float32Array) => {
          let sum = 0;
          let max = 0;
          let above = 0;
          const diffs = new Float32Array(a.length);
          for (let index = 0; index < a.length; index += 1) {
            const diff = Math.abs((a[index] ?? 0) - (b[index] ?? 0));
            diffs[index] = diff;
            sum += diff;
            if (diff > max) max = diff;
            if (diff > 0.05) above += 1;
          }
          diffs.sort();
          return {
            meanAbsDiff: sum / a.length,
            maxAbsDiff: max,
            p99AbsDiff: diffs[Math.floor(diffs.length * 0.99)] ?? 0,
            fractionAbove0_05: above / a.length,
          };
        };
        const plane = 800 * 800;
        const channelMeans = (values: Float32Array): number[] =>
          [0, 1, 2].map((channel) => {
            let total = 0;
            for (let index = 0; index < plane; index += 1) {
              total += values[channel * plane + index] ?? 0;
            }
            return total / plane;
          });
        return {
          fixture,
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
          shapes: { reference: reference.pixel_values.dims, browser: browser.pixel_values.dims },
          stats: {
            ...compare(left, right),
            referenceChannelMeans: channelMeans(left),
            browserChannelMeans: channelMeans(right),
          },
          antialiasing: {
            referenceVsBoxAverage: compare(left, box),
            browserVsBoxAverage: compare(right, box),
          },
        };
      },
      { fixture: FIXTURE, engineModule: ENGINE_MODULE },
    )) as unknown as ParityResult;

    result.notes = [
      'Both tensors come from the shipped engine functions loaded through the dev server (Vite /@fs/ route), not from a reimplementation.',
      'The reference path is the one the Node real-model gate validates; the browser path is the one the panel ships.',
      'This measures preprocessing parity only. Detection parity still requires the 2.4 GB detector in the browser and remains unverified.',
    ];

    const evidenceDir = path.resolve('reports/inference-platform');
    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = path.join(
      evidenceDir,
      `discovery-preprocess-parity-${process.env.VARVE_E2E_PORT ?? 'default'}.json`,
    );
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await testInfo.attach('discovery-preprocess-parity', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    console.log(
      `PREPROCESS PARITY reference ${JSON.stringify(result.shapes.reference)} browser ${JSON.stringify(result.shapes.browser)} meanAbsDiff ${result.stats.meanAbsDiff.toFixed(4)} p99 ${result.stats.p99AbsDiff.toFixed(4)} max ${result.stats.maxAbsDiff.toFixed(4)} >0.05 ${(result.stats.fractionAbove0_05 * 100).toFixed(2)}%`,
    );
    console.log(
      `PREPROCESS PARITY channel means reference ${result.stats.referenceChannelMeans.map((v) => v.toFixed(3)).join(',')} browser ${result.stats.browserChannelMeans.map((v) => v.toFixed(3)).join(',')} -> ${evidencePath}`,
    );

    // Structural contract only. The measured difference between the two
    // resize filters is *reported*, not asserted away: this probe exists to
    // find out how the shipped path differs, and a tight bound would either be
    // invented or would silently bless a filter change. What is asserted is
    // the wiring: identical shapes, and channel statistics close enough that a
    // wrong mean/std, channel swap, or missing normalization would fail.
    expect(result.shapes.reference).toEqual(result.shapes.browser);
    expect(result.shapes.reference).toEqual([1, 3, 800, 800]);
    expect(result.stats.meanAbsDiff).toBeLessThan(1.0);
    for (let channel = 0; channel < 3; channel += 1) {
      const referenceMean = result.stats.referenceChannelMeans[channel] ?? 0;
      const browserMean = result.stats.browserChannelMeans[channel] ?? 0;
      expect(Math.abs(referenceMean - browserMean)).toBeLessThan(0.15);
    }
    // Filter-quality contract: the shipped path must be at least as close to an
    // independent area average as the reference path it replaces. That is the
    // claim the code comment makes, and it is checkable without the detector.
    expect(result.antialiasing.browserVsBoxAverage.meanAbsDiff).toBeLessThanOrEqual(
      result.antialiasing.referenceVsBoxAverage.meanAbsDiff + 1e-6,
    );
  });
});
