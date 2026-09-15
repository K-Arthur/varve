/**
 * WebGPU presentation parity: circle coverage under an affine transform.
 *
 * The fragment discard test must run in the circle's local space. A
 * screen-space `distance(pos, center) > r` test happens to be correct under
 * uniform zoom because the camera and a uniform item scale map circles to
 * circles — but a non-uniform item scale or skew maps a circle to an ellipse,
 * and the screen-space test then discards every pixel outside a circle of
 * radius `r`, producing a clipped/stretched result.
 *
 * This spec renders the same solid circle through the canonical Canvas2D
 * replay and through `WebGPUBackend` on this machine's real hardware adapter,
 * then compares coverage geometry and pixels. It skips (with a reason) when
 * no hardware adapter is exposed, because the production policy declines
 * software adapters and a SwiftShader run would not exercise the GPU path.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SHOT_DIR = process.env.VARVE_SHADER_SHOT_DIR ?? '/tmp/varve-shader-circles';

test.use({
  launchOptions: {
    channel: 'chromium',
    ignoreDefaultArgs: ['--no-startup-window'],
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=vulkan',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=0',
    ],
  },
});

test('circle coverage honors non-uniform scale and skew', async ({ page }) => {
  // Origin bootstrap only. `/manifest.json` opens a JSON viewer that swaps
  // the document out from under `page.evaluate`; navigating to the app root
  // with `commit` gives a stable localhost origin without waiting for the
  // editor module graph, and `setContent` replaces the in-flight app DOM.
  await page.goto('/', { waitUntil: 'commit' });
  await page.setContent('<html><body><div id="compositor-parity-host"></div></body></html>');

  const compositorUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const result = await page.evaluate(async (url) => {
    interface Metrics {
      name: string;
      referenceCoverage: number;
      gpuCoverage: number;
      referenceBBox: { w: number; h: number };
      gpuBBox: { w: number; h: number };
      meanAbsDiff: number;
      maxAbsDiff: number;
      meanInteriorDiff: number;
      maxInteriorDiff: number;
      referencePng: string;
      gpuPng: string;
    }
    interface BackendLike {
      init(canvas: HTMLCanvasElement): Promise<void>;
      beginFrame(frame: unknown, opts?: { applyCamera?: boolean; clear?: boolean }): void;
      drawVectorItems(items: unknown[]): void;
      endFrame(): void;
      getDiagnostics(): { gpuActive: boolean; adapterIsFallback: boolean };
      destroy(): void;
    }
    const mod = (await import(/* @vite-ignore */ url)) as {
      Canvas2DBackend: new () => BackendLike;
      WebGPUBackend: new () => BackendLike;
    };

    const WIDTH = 200;
    const HEIGHT = 140;
    const cases = [
      { name: 'uniform', transform: [1, 0, 0, 1, 40, 40] },
      { name: 'scaled-x2', transform: [2, 0, 0, 1, 40, 40] },
      { name: 'skewed', transform: [2, 0.6, -0.6, 1, 40, 40] },
    ];

    const referenceCanvas = document.createElement('canvas');
    referenceCanvas.width = WIDTH;
    referenceCanvas.height = HEIGHT;
    const gpuCanvas = document.createElement('canvas');
    gpuCanvas.width = WIDTH;
    gpuCanvas.height = HEIGHT;

    const reference = new mod.Canvas2DBackend();
    await reference.init(referenceCanvas);
    const gpu = new mod.WebGPUBackend();
    await gpu.init(gpuCanvas);
    const diagnostics = gpu.getDiagnostics();

    const analyze = (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D context missing');
      const image = ctx.getImageData(0, 0, WIDTH, HEIGHT);
      let minX = WIDTH;
      let minY = HEIGHT;
      let maxX = -1;
      let maxY = -1;
      let coverage = 0;
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const alpha = image.data[(y * WIDTH + x) * 4 + 3] ?? 0;
          if (alpha > 8) {
            coverage += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return {
        coverage,
        bbox: maxX < 0 ? { w: 0, h: 0 } : { w: maxX - minX + 1, h: maxY - minY + 1 },
        image,
        png: canvas.toDataURL('image/png'),
      };
    };

    const diff = (
      a: Uint8ClampedArray,
      b: Uint8ClampedArray,
    ): { mean: number; max: number; meanInterior: number; maxInterior: number } => {
      const alphaAt = (data: Uint8ClampedArray, x: number, y: number): number =>
        data[(y * WIDTH + x) * 4 + 3] ?? 0;
      let sum = 0;
      let max = 0;
      let count = 0;
      let interiorSum = 0;
      let interiorMax = 0;
      let interiorCount = 0;
      const interior = (x: number, y: number): boolean => {
        if (x < 2 || y < 2 || x >= WIDTH - 2 || y >= HEIGHT - 2) return false;
        for (const [dx, dy] of [
          [-2, 0],
          [2, 0],
          [0, -2],
          [0, 2],
        ] as const) {
          const px = x + dx;
          const py = y + dy;
          if (alphaAt(a, px, py) <= 250 || alphaAt(b, px, py) <= 250) return false;
        }
        return true;
      };
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const index = (y * WIDTH + x) * 4;
          const alphaA = a[index + 3] ?? 0;
          const alphaB = b[index + 3] ?? 0;
          if (alphaA <= 8 && alphaB <= 8) continue;
          const deep = interior(x, y);
          for (let channel = 0; channel < 3; channel += 1) {
            const value = Math.abs((a[index + channel] ?? 0) - (b[index + channel] ?? 0));
            sum += value;
            if (value > max) max = value;
            count += 1;
            if (deep) {
              interiorSum += value;
              if (value > interiorMax) interiorMax = value;
              interiorCount += 1;
            }
          }
        }
      }
      return {
        mean: count > 0 ? sum / count : 0,
        max,
        meanInterior: interiorCount > 0 ? interiorSum / interiorCount : 0,
        maxInterior: interiorMax,
      };
    };

    const metrics: Metrics[] = [];
    for (const testCase of cases) {
      const items = [
        {
          transform: testCase.transform,
          fill: { space: 'rgb', r: 30, g: 160, b: 220, a: 255 },
          primitive: { kind: 'circle', cx: 0, cy: 0, r: 24 },
          opacity: 1,
          blendMode: 'normal',
          strokes: [],
          effects: [],
        },
      ];
      const frame = {
        items,
        camera: { zoom: 1, pan: { x: 0, y: 0 } },
        viewport: { width: WIDTH, height: HEIGHT },
        docVersion: 1,
      };

      reference.beginFrame(frame);
      reference.drawVectorItems(items);
      reference.endFrame();
      const referenceStats = analyze(referenceCanvas);

      gpu.beginFrame(frame);
      gpu.drawVectorItems(items);
      gpu.endFrame();
      const gpuStats = analyze(gpuCanvas);

      const pixelDiff = diff(referenceStats.image.data, gpuStats.image.data);
      metrics.push({
        name: testCase.name,
        referenceCoverage: referenceStats.coverage,
        gpuCoverage: gpuStats.coverage,
        referenceBBox: referenceStats.bbox,
        gpuBBox: gpuStats.bbox,
        meanAbsDiff: pixelDiff.mean,
        maxAbsDiff: pixelDiff.max,
        meanInteriorDiff: pixelDiff.meanInterior,
        maxInteriorDiff: pixelDiff.maxInterior,
        referencePng: referenceStats.png,
        gpuPng: gpuStats.png,
      });
    }

    return { diagnostics, metrics };
  }, compositorUrl);

  test.skip(
    !result.diagnostics.gpuActive || result.diagnostics.adapterIsFallback,
    'No hardware WebGPU adapter in this browser session; GPU presentation parity unverified here.',
  );

  mkdirSync(SHOT_DIR, { recursive: true });
  for (const metric of result.metrics) {
    for (const side of ['reference', 'gpu'] as const) {
      const dataUrl = side === 'reference' ? metric.referencePng : metric.gpuPng;
      writeFileSync(
        path.join(SHOT_DIR, `${metric.name}-${side}.png`),
        Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'),
      );
    }
    const widthRatio = metric.gpuBBox.w / metric.referenceBBox.w;
    const heightRatio = metric.gpuBBox.h / metric.referenceBBox.h;
    const coverageRatio = metric.gpuCoverage / metric.referenceCoverage;
    // A screen-space discard clips the long axis back to the unscaled radius
    // (width ratio ~0.5, coverage ratio ~0.5). Parity keeps all three near 1.
    expect(widthRatio, `${metric.name}: bbox width ratio`).toBeGreaterThan(0.92);
    expect(widthRatio, `${metric.name}: bbox width ratio`).toBeLessThan(1.08);
    expect(heightRatio, `${metric.name}: bbox height ratio`).toBeGreaterThan(0.92);
    expect(heightRatio, `${metric.name}: bbox height ratio`).toBeLessThan(1.08);
    expect(coverageRatio, `${metric.name}: coverage ratio`).toBeGreaterThan(0.9);
    expect(coverageRatio, `${metric.name}: coverage ratio`).toBeLessThan(1.1);
    expect(metric.meanAbsDiff, `${metric.name}: mean channel diff`).toBeLessThan(12);
    // Interior-only: WebGPU coverage is aliased (no MSAA) while Canvas2D
    // antialiases, so the boundary band legitimately differs. A wrong fill
    // colour or a clipped region shows up in the interior statistics too.
    expect(metric.meanInteriorDiff, `${metric.name}: mean interior diff`).toBeLessThan(4);
    expect(metric.maxInteriorDiff, `${metric.name}: max interior diff`).toBeLessThan(12);
  }
});
