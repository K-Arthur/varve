import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

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

test('repeated rectangles and upload chunks preserve their paint order', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await page.setContent('<html><body></body></html>');
  const compositorUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const result = await page.evaluate(async (url) => {
    interface BackendLike {
      init(canvas: HTMLCanvasElement): Promise<void>;
      beginFrame(frame: unknown, opts: { applyCamera: boolean; clear: boolean }): void;
      drawVectorItems(items: unknown[]): void;
      endFrame(): void;
      getDiagnostics(): {
        gpuActive: boolean;
        adapterIsFallback: boolean;
        lastFrameGpuItems?: number;
      };
      destroy(): void;
    }
    const mod = (await import(/* @vite-ignore */ url)) as {
      WebGPUBackend: new () => BackendLike;
      Canvas2DBackend: new () => BackendLike;
    };
    const batch = (await import(
      /* @vite-ignore */ url.replace('/index.ts', '/webgpu/backend.ts')
    )) as {
      maxSolidItemsPerUpload(maxBufferSize: number): number;
    };
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 80;
    const backend = new mod.WebGPUBackend();
    await backend.init(canvas);
    const ready = backend.getDiagnostics();
    if (!ready.gpuActive || ready.adapterIsFallback) {
      backend.destroy();
      return { skipped: true, samples: [], reusePng: '', chunk: null };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D presentation context missing');
    const render = (x: number, red: boolean, docVersion: number) => {
      const item = {
        transform: [1, 0, 0, 1, x, 20],
        fill: { space: 'rgb', r: red ? 240 : 20, g: 20, b: red ? 20 : 240, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      };
      backend.beginFrame(
        {
          items: [item],
          camera: { zoom: 1, pan: { x: 0, y: 0 } },
          viewport: { width: 128, height: 80 },
          docVersion,
        },
        { applyCamera: false, clear: true },
      );
      backend.drawVectorItems([item]);
      backend.endFrame();
      const left = [...ctx.getImageData(25, 35, 1, 1).data];
      const right = [...ctx.getImageData(85, 35, 1, 1).data];
      return { left, right, gpuItems: backend.getDiagnostics().lastFrameGpuItems };
    };

    const samples = [render(10, true, 1), render(70, false, 2), render(10, true, 3)];
    const reusePng = canvas.toDataURL('image/png');

    const chunkSize = batch.maxSolidItemsPerUpload(4 * 1024 * 1024);
    const filler = {
      transform: [1, 0, 0, 1, -1000, -1000],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
    };
    const chunkItems = Array(chunkSize + 1).fill(filler);
    chunkItems[chunkSize - 1] = {
      ...filler,
      transform: [1, 0, 0, 1, 40, 20],
      fill: { space: 'rgb', r: 240, g: 20, b: 20, a: 255 },
      opacity: 0.5,
    };
    chunkItems[chunkSize] = {
      ...filler,
      transform: [1, 0, 0, 1, 40, 20],
      fill: { space: 'rgb', r: 20, g: 20, b: 240, a: 255 },
      opacity: 0.5,
    };
    const chunkFrame = {
      items: chunkItems,
      camera: { zoom: 1, pan: { x: 0, y: 0 } },
      viewport: { width: 128, height: 80 },
      docVersion: 4,
    };
    backend.beginFrame(chunkFrame, { applyCamera: false, clear: true });
    backend.drawVectorItems(chunkItems);
    backend.endFrame();
    const gpuPixel = [...ctx.getImageData(55, 35, 1, 1).data];
    const gpuItems = backend.getDiagnostics().lastFrameGpuItems;
    const gpuPng = canvas.toDataURL('image/png');
    backend.destroy();

    const referenceCanvas = document.createElement('canvas');
    referenceCanvas.width = 128;
    referenceCanvas.height = 80;
    const reference = new mod.Canvas2DBackend();
    await reference.init(referenceCanvas);
    reference.beginFrame(chunkFrame, { applyCamera: false, clear: true });
    reference.drawVectorItems(chunkItems);
    reference.endFrame();
    const referencePixel = [
      ...(referenceCanvas.getContext('2d')?.getImageData(55, 35, 1, 1).data ?? []),
    ];
    const referencePng = referenceCanvas.toDataURL('image/png');
    reference.destroy();
    return {
      skipped: false,
      samples,
      reusePng,
      chunk: {
        gpuPixel,
        referencePixel,
        gpuItems,
        itemCount: chunkItems.length,
        gpuPng,
        referencePng,
      },
    };
  }, compositorUrl);

  if (result.skipped) test.skip(true, 'No hardware WebGPU adapter is exposed by this browser');
  writeFileSync(
    '/tmp/varve-gpu-rect-reuse.png',
    Buffer.from(result.reusePng.replace(/^data:image\/png;base64,/, ''), 'base64'),
  );
  expect(result.samples[0]?.gpuItems).toBe(1);
  expect(result.samples[1]?.gpuItems).toBe(1);
  expect(result.samples[2]?.gpuItems).toBe(1);
  expect(result.samples[0]?.left).toEqual(result.samples[2]?.left);
  expect(result.samples[0]?.right).toEqual(result.samples[2]?.right);
  expect(result.chunk?.gpuItems).toBe(result.chunk?.itemCount);
  for (const [label, png] of [
    ['gpu', result.chunk?.gpuPng],
    ['reference', result.chunk?.referencePng],
  ] as const) {
    if (!png) throw new Error('Chunk-boundary screenshot missing');
    writeFileSync(
      `/tmp/varve-gpu-rect-chunk-${label}.png`,
      Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'),
    );
  }
  for (let channel = 0; channel < 4; channel++) {
    expect(
      Math.abs(
        (result.chunk?.gpuPixel[channel] ?? 0) - (result.chunk?.referencePixel[channel] ?? 0),
      ),
    ).toBeLessThanOrEqual(3);
  }
});
