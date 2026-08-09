// @vitest-environment jsdom

import type { RenderItem } from '@varve/engine';
import { applyAffine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { Canvas2DBackend } from '../canvas2d/backend';
import {
  applyItemAffine,
  isGpuBatchSupported,
  lineTessellationVertexCount,
  WebGPUBackend,
} from './backend';

const FIXTURE_ITEMS: RenderItem[] = [
  {
    transform: [1, 0, 0, 1, 10, 10],
    fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    primitive: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  },
  {
    transform: [1, 0, 0, 1, 50, 50],
    fill: { space: 'rgb', r: 200, g: 50, b: 50, a: 255 },
    primitive: { kind: 'circle', cx: 0, cy: 0, r: 15 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  },
  {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 30, g: 30, b: 200, a: 255 },
    primitive: { kind: 'line', from: [5, 5], to: [90, 90], tolerance: 4 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  },
];

function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let diff = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 4) {
    const a0 = a[i];
    if (a0 === undefined) break;
    const a1 = a[i + 1];
    if (a1 === undefined) break;
    const a2 = a[i + 2];
    if (a2 === undefined) break;
    const a3 = a[i + 3];
    if (a3 === undefined) break;
    const b0 = b[i];
    if (b0 === undefined) break;
    const b1 = b[i + 1];
    if (b1 === undefined) break;
    const b2 = b[i + 2];
    if (b2 === undefined) break;
    const b3 = b[i + 3];
    if (b3 === undefined) break;
    diff += Math.abs(a0 - b0) + Math.abs(a1 - b1) + Math.abs(a2 - b2) + Math.abs(a3 - b3);
  }
  return diff / (n / 4);
}

describe('WebGPU golden diff vs Canvas2D', () => {
  const frame = {
    items: FIXTURE_ITEMS,
    camera: { zoom: 1, pan: { x: 0, y: 0 } },
    viewport: { width: 128, height: 128 },
    docVersion: 1,
  };

  it('line primitive tessellates to 6 vertices (2 triangles)', () => {
    const LINE_ITEM: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 30, g: 30, b: 200, a: 255 },
      primitive: { kind: 'line', from: [5, 5], to: [90, 90], tolerance: 4 },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
    };
    expect(lineTessellationVertexCount(LINE_ITEM)).toBe(6);
  });

  it('fails closed for batches whose paint or ordering semantics WebGPU cannot reproduce', () => {
    const solidRect = FIXTURE_ITEMS[0]!;
    const imageRect: RenderItem = {
      ...solidRect,
      fills: [
        {
          type: 'image',
          src: 'data:image/png;base64,AAAA',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    };
    const strokedRect: RenderItem = {
      ...solidRect,
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 1,
          align: 'center',
          dashPattern: [],
          dashOffset: 0,
          cap: 'butt',
          join: 'miter',
          miterLimit: 4,
          visible: true,
        },
      ],
    };
    const blendedRect: RenderItem = { ...solidRect, blendMode: 'multiply' };

    expect(isGpuBatchSupported([solidRect])).toBe(true);
    expect(isGpuBatchSupported([solidRect, imageRect])).toBe(false);
    expect(isGpuBatchSupported([strokedRect])).toBe(false);
    expect(isGpuBatchSupported([blendedRect])).toBe(false);
    // Line tessellation currently uses a fixed width and therefore cannot
    // claim semantic parity with the Canvas2D stroke contract.
    expect(isGpuBatchSupported([FIXTURE_ITEMS[2]!])).toBe(false);
  });

  it('applyItemAffine matches @varve/shared applyAffine (a·x+c·y+e)', () => {
    const t = [2, 0.5, -0.25, 3, 10, -4] as const;
    const p = [4, 6] as const;
    expect(applyItemAffine(p, t)).toEqual(applyAffine(t, p));
    // Identity must be a true identity (the prior WGSL bug mapped (x,y)→(x+1,0)).
    expect(applyItemAffine([7, 9], [1, 0, 0, 1, 0, 0])).toEqual([7, 9]);
    expect(applyItemAffine([0, 0], [1, 0, 0, 1, 40, 50])).toEqual([40, 50]);
  });

  it('keeps a 2D context on the present canvas after init (ownership invert)', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const wgpu = new WebGPUBackend();
    await wgpu.init(canvas);
    expect(wgpu.presentCanvasHas2dContext()).toBe(true);
    expect(canvas.getContext('2d')).not.toBeNull();
    wgpu.destroy();
  });

  it('fallback path matches Canvas2D for rect+circle+line', async () => {
    const canvasRef = document.createElement('canvas');
    canvasRef.width = 128;
    canvasRef.height = 128;
    const c2d = new Canvas2DBackend();
    await c2d.init(canvasRef);
    c2d.beginFrame(frame, { applyCamera: false });
    c2d.drawVectorItems(FIXTURE_ITEMS);
    c2d.endFrame();
    const refCtx = canvasRef.getContext('2d');
    if (!refCtx) throw new Error('Expected 2d context for canvas');
    const ref = refCtx.getImageData(0, 0, 128, 128).data;

    const canvasGpu = document.createElement('canvas');
    canvasGpu.width = 128;
    canvasGpu.height = 128;
    const wgpu = new WebGPUBackend();
    await wgpu.init(canvasGpu);
    wgpu.beginFrame(frame, { applyCamera: false });
    wgpu.drawVectorItems(FIXTURE_ITEMS);
    wgpu.endFrame();
    const outCtx = canvasGpu.getContext('2d');
    if (!outCtx) throw new Error('Expected 2d context for canvas');
    const out = outCtx.getImageData(0, 0, 128, 128).data;

    expect(pixelDiff(ref, out)).toBeLessThan(8);
    c2d.destroy();
    wgpu.destroy();
  });

  it('declines a software-emulated adapter before requesting a device', async () => {
    let requestDeviceCalls = 0;
    const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({
          info: { device: 'SwiftShader Device (LLVM)' },
          requestDevice: async () => {
            requestDeviceCalls++;
            throw new Error('requestDevice should not be called for a declined software adapter');
          },
        }),
        getPreferredCanvasFormat: () => 'rgba8unorm',
      },
    });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const wgpu = new WebGPUBackend();
      await wgpu.init(canvas);
      const diag = wgpu.getDiagnostics();
      expect(requestDeviceCalls).toBe(0);
      expect(diag.gpuActive).toBe(false);
      expect(diag.adapterIsFallback).toBe(true);
      wgpu.destroy();
    } finally {
      Object.defineProperty(navigator, 'gpu', { configurable: true, value: originalGpu });
    }
  });

  it.skipIf(typeof (navigator as Navigator & { gpu?: GPU }).gpu === 'undefined')(
    'native WebGPU path renders without error',
    async () => {
      const canvasGpu = document.createElement('canvas');
      canvasGpu.width = 128;
      canvasGpu.height = 128;
      const wgpu = new WebGPUBackend();
      await wgpu.init(canvasGpu);
      // Separate from WASM init latency (Task 13) — only measurable with a real adapter.
      expect(wgpu.getDiagnostics().pipelineInitMs).toBeGreaterThanOrEqual(0);
      wgpu.beginFrame(frame, { applyCamera: false, clear: true });
      wgpu.drawVectorItems(FIXTURE_ITEMS);
      wgpu.endFrame();
      wgpu.destroy();
      expect(true).toBe(true);
    },
  );

  it('reports deviceLost + gpuActive:false once GPUDevice.lost resolves; present 2D survives', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const wgpu = new WebGPUBackend();
    await wgpu.init(canvas);

    let resolveLost: (info: { reason: string; message: string }) => void = () => {};
    const lost = new Promise<{ reason: string; message: string }>((resolve) => {
      resolveLost = resolve;
    });
    const fakeDevice = { lost } as unknown as GPUDevice;

    expect(wgpu.getDiagnostics().deviceLost).toBe(false);
    wgpu.watchDeviceLost(fakeDevice);
    resolveLost({ reason: 'unknown', message: 'simulated device loss' });
    await lost;
    await Promise.resolve();
    await Promise.resolve();

    const diag = wgpu.getDiagnostics();
    expect(diag.deviceLost).toBe(true);
    expect(diag.gpuActive).toBe(false);
    // Ownership invert: content canvas stays 2D, so drawing still works.
    expect(wgpu.presentCanvasHas2dContext()).toBe(true);
    wgpu.beginFrame(frame, { applyCamera: false });
    wgpu.drawVectorItems(FIXTURE_ITEMS);
    wgpu.endFrame();
    wgpu.destroy();
  });

  it('createCompositorBackend does not attempt an in-place onDeviceLost canvas2d swap', async () => {
    // Regression test: a browser <canvas> element's context type is fixed
    // for its lifetime, so re-initializing a Canvas2DBackend on the same
    // canvas after a WebGPU context was already bound to it cannot work.
    // The router used to attempt exactly this via a dead closure (the
    // reassignment never reached the caller, who already holds the
    // original backend reference by value) — assert it's gone, not
    // silently reintroduced.
    const { createCompositorBackend } = await import('../router');
    const canvas = document.createElement('canvas');
    const { backend } = await createCompositorBackend(canvas, { preferWebGpu: true });
    expect((backend as { onDeviceLost?: unknown }).onDeviceLost).toBeUndefined();
    backend.destroy();
  });
});
