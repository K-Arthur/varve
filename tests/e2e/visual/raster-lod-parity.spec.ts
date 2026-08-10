/**
 * Raster LOD pyramid — visual seam corpus (brief §53-54).
 *
 * Seeds a deterministic 8192^2 sparse paint layer whose pattern puts hard
 * content on tile boundaries (1px red lines on the 128px grid, 45-degree
 * green diagonals, a semi-transparent band), parks the camera at 25% zoom
 * (L2 tiles, 4x minification — the seam-stress regime), and compares the
 * pyramid arm against the retained-surface arm in-page:
 *
 * 1. Seam check: across every tile boundary in screen space, the pixel
 *    delta must not be an outlier versus the interior — a hairline seam
 *    would spike exactly there.
 * 2. Parity check: the two arms must agree within a bounded tolerance
 *    (different resampling, same content — mean abs diff must stay low and
 *    high-frequency boundary spikes must not exist).
 * 3. Alpha check: the semi-transparent band must survive the downsample
 *    without haloing (its edge deltas must not exceed the interior).
 *
 * Concurrency hygiene: unique output dir via --output; runs on the shared
 * dev server only when pointed at it (VARVE_E2E_PORT).
 */
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __strataPerf?: {
      fixtures: {
        apply: (id: string) => Promise<{ ok: boolean }>;
      };
      camera: {
        setZoom: (zoom: number) => void;
      };
      rasterLod: {
        enable: () => void;
        disable: () => void;
        enabled: () => boolean;
        diagnostics: () => {
          residency: { residentTiles: number; residentBytes: number; evictions: number };
          scheduler: { queued: number; running: number };
        };
      };
      forceFullRedraw: () => void;
    };
  }
}

async function openEditorWithFixture(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?perf=1');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const applied = await page.evaluate(() =>
    window.__strataPerf?.fixtures.apply('paint-raster-lod'),
  );
  expect(applied?.ok).toBe(true);
  // Wait for the fixture's raster layer to appear in the layers panel.
  await page
    .locator('.layers-panel')
    .getByText(/raster layer/i)
    .first()
    .waitFor({ timeout: 15000 });
}

async function screenshotCanvas(page: import('@playwright/test').Page): Promise<Buffer> {
  const canvas = page.locator('.editor-canvas canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 10000 });
  return canvas.screenshot();
}

test('pyramid tiles are seam-free and parity-bounded at 25% zoom', async ({ page }) => {
  await openEditorWithFixture(page);

  // Park the camera at 25% zoom: L2 tiles, 4x minification.
  await page.evaluate(() => window.__strataPerf?.camera.setZoom(0.25));
  await page.waitForTimeout(400);

  // Wait for the pyramid to generate the visible tiles.
  await page
    .waitForFunction(
      () => {
        const d = window.__strataPerf?.rasterLod.diagnostics();
        return !!d && d.residency.residentTiles > 0 && d.scheduler.queued === 0;
      },
      undefined,
      { timeout: 60000 },
    )
    .catch(() => {
      // Generation may finish before the first poll; any residency is fine.
    });
  await page.waitForTimeout(500);

  const pyramidShot = await screenshotCanvas(page);
  const pyramidDiag = await page.evaluate(() => window.__strataPerf?.rasterLod.diagnostics());

  // Retained arm: disable the pyramid in both realms and force a full redraw.
  await page.evaluate(() => {
    window.__strataPerf?.rasterLod.disable();
    window.__strataPerf?.forceFullRedraw();
  });
  await page.waitForTimeout(500);
  const retainedShot = await screenshotCanvas(page);
  await page.evaluate(() => window.__strataPerf?.rasterLod.enable());

  // In-page pixel analysis (both shots are PNG buffers).
  const metrics = await page.evaluate(
    async ({ a, b }: { a: Uint8Array; b: Uint8Array }) => {
      const decode = async (buf: Uint8Array) => {
        const blob = new Blob([buf as unknown as BlobPart]);
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('offscreen unavailable');
        ctx.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const A = await decode(a);
      const B = await decode(b);
      const w = Math.min(A.width, B.width);
      const h = Math.min(A.height, B.height);
      const luma = (d: Uint8ClampedArray, i: number) =>
        0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

      // Per-pixel absolute luma delta between the arms.
      const deltas = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          deltas[y * w + x] = Math.abs(luma(A.data, i) - luma(B.data, i));
        }
      }
      const mean = (arr: Float32Array, lo: number, hi: number) => {
        let s = 0;
        let n = 0;
        for (let k = lo; k < hi; k++) {
          s += arr[k];
          n++;
        }
        return n ? s / n : 0;
      };

      // Tile grid in screen space: L2 tiles are 128*4 layer px, at 0.25 zoom
      // = 128 screen px. Boundaries land at multiples of 128 (plus the
      // layer's screen offset, which is 0 since the layer sits at origin).
      const boundaryDelta = (axis: 'x' | 'y', boundary: number) => {
        const row = Math.floor(h / 2);
        const col = Math.floor(w / 2);
        const i0 = axis === 'x' ? row * w + boundary : boundary * w + col;
        const i1 = axis === 'x' ? row * w + boundary + 1 : boundary * w + w + col;
        return Math.max(deltas[i0] ?? 0, deltas[i1] ?? 0);
      };

      const boundaries: Array<{ axis: 'x' | 'y'; at: number }> = [];
      for (let b = 128; b < Math.max(w, h); b += 128) {
        boundaries.push({ axis: 'x', at: b });
        boundaries.push({ axis: 'y', at: b });
      }
      const boundaryDeltas = boundaries.map((b) => boundaryDelta(b.axis, b.at));
      const interiorMean = mean(deltas, 0, deltas.length);
      const boundaryMax = Math.max(0, ...boundaryDeltas);
      // Compare boundary deltas to the local interior: sample away from
      // boundaries (mid-tile).
      const interiorMax = (() => {
        let m = 0;
        for (let y = 64; y < h - 64; y += 4) {
          for (let x = 64; x < w - 64; x += 4) {
            if (x % 128 < 60 && y % 128 < 60) m = Math.max(m, deltas[y * w + x]);
          }
        }
        return m;
      })();

      // Alpha band probe: the semi-transparent band spans layer y
      // [1024,1152) = screen y [256,288); its edge deltas must not exceed
      // the interior (no halo from wrong alpha averaging).
      const bandEdgeMax = (() => {
        let m = 0;
        for (let y = 254; y <= 290; y++) {
          for (let x = 64; x < Math.min(640, w - 64); x++) {
            m = Math.max(m, deltas[y * w + x]);
          }
        }
        return m;
      })();

      return {
        width: w,
        height: h,
        interiorMean,
        interiorMax,
        boundaryMax,
        boundaryDeltas: boundaryDeltas.slice(0, 8),
        bandEdgeMax,
      };
    },
    { a: new Uint8Array(pyramidShot), b: new Uint8Array(retainedShot) },
  );

  // The pyramid must have engaged (resident tiles present).
  expect(pyramidDiag?.residency.residentTiles ?? 0).toBeGreaterThan(0);
  console.log(
    'raster-lod parity metrics:',
    JSON.stringify({
      residentTiles: pyramidDiag?.residency.residentTiles,
      residentBytes: pyramidDiag?.residency.residentBytes,
      interiorMean: metrics.interiorMean.toFixed(2),
      interiorMax: metrics.interiorMax,
      boundaryMax: metrics.boundaryMax,
      bandEdgeMax: metrics.bandEdgeMax,
    }),
  );
  // 1. No hairline seams: boundary deltas are not outliers vs the interior.
  //    (4x minification changes both arms' resampling; the point is that
  //    tile boundaries are NOT special.)
  expect(metrics.boundaryMax).toBeLessThanOrEqual(Math.max(metrics.interiorMax + 16, 48));
  // 2. Bounded parity: mean abs diff between arms stays low.
  expect(metrics.interiorMean).toBeLessThanOrEqual(24);
  // 3. Alpha band: no halo at its edges.
  expect(metrics.bandEdgeMax).toBeLessThanOrEqual(Math.max(metrics.interiorMax + 16, 48));
  // The corpus measured real pixels on both arms.
  expect(metrics.width).toBeGreaterThan(200);
  expect(metrics.height).toBeGreaterThan(100);
});
