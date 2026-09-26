// @vitest-environment jsdom

import type { RenderItem } from '@varve/engine';
import { applyAffine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { Canvas2DBackend } from '../canvas2d/backend';
import {
  applyItemAffine,
  isGpuBatchSupported,
  lineTessellationVertexCount,
  normalizedGpuFillColor,
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

  it('uploads managed colors through normalized working values', () => {
    expect(
      normalizedGpuFillColor({
        space: 'rgb',
        bitDepth: 'float32',
        r: 0.5,
        g: 0.25,
        b: 0.125,
        a: 1,
      }),
    ).toEqual([0.5, 0.25, 0.125, 1]);
    const cmyk = normalizedGpuFillColor({
      space: 'cmyk',
      bitDepth: 'float32',
      c: 0,
      m: 0.25,
      y: 0.5,
      k: 0,
      a: 1,
    });
    expect(cmyk[0]).toBeCloseTo(1, 6);
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

  it('accepts non-uniform/skewed circle transforms and rejects degenerate affines', () => {
    const circle = FIXTURE_ITEMS[1]!;
    // Local-space fragment coverage makes these exact; they must stay on GPU.
    expect(isGpuBatchSupported([{ ...circle, transform: [2, 0, 0, 1, 10, 10] }])).toBe(true);
    expect(isGpuBatchSupported([{ ...circle, transform: [1, 0.4, 0, 1, 10, 10] }])).toBe(true);
    // A singular affine paints nothing in Canvas2D; a degenerate GPU triangle
    // could still cover pixels. Fail closed so the two backends agree.
    expect(isGpuBatchSupported([{ ...circle, transform: [0, 0, 0, 0, 10, 10] }])).toBe(false);
    expect(isGpuBatchSupported([{ ...circle, transform: [1, 0, 2, 0, 10, 10] }])).toBe(false);
  });

  it('applyItemAffine matches @varve/shared applyAffine (a·x+c·y+e)', () => {
    const t = [2, 0.5, -0.25, 3, 10, -4] as const;
    const p = [4, 6] as const;
    expect(applyItemAffine(p, t)).toEqual(applyAffine(t, p));
    // Identity must be a true identity (the prior WGSL bug mapped (x,y)→(x+1,0)).
    expect(applyItemAffine([7, 9], [1, 0, 0, 1, 0, 0])).toEqual([7, 9]);
    expect(applyItemAffine([0, 0], [1, 0, 0, 1, 40, 50])).toEqual([40, 50]);
  });

  it('does not route rounded rectangles to a square-only GPU quad', () => {
    const rect = FIXTURE_ITEMS[0];
    if (rect?.primitive.kind !== 'rect') throw new Error('Expected rectangle fixture');
    expect(
      isGpuBatchSupported([{ ...rect, primitive: { ...rect.primitive, cornerRadius: 8 } }]),
    ).toBe(false);
    expect(
      isGpuBatchSupported([
        {
          ...rect,
          primitive: { ...rect.primitive, cornerRadius: [4, 8, 4, 8], cornerSmoothing: 0.5 },
        },
      ]),
    ).toBe(false);
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

  it('replays an eligible run on Canvas2D when GPU submission throws', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const backend = new WebGPUBackend();
    await backend.init(canvas);
    backend.beginFrame(frame, { applyCamera: false, clear: true });
    const present = (backend as unknown as { present: Canvas2DBackend }).present;
    const replay = vi.spyOn(present, 'drawVectorItems');

    const destroyDevice = vi.fn();
    Object.assign(backend, {
      gpuReady: true,
      device: { limits: { maxBufferSize: 4 * 1024 * 1024 }, destroy: destroyDevice },
      context: {},
      solidPipeline: {},
      circlePipeline: {},
      cameraBuffer: {},
      cameraBindGroup: {},
      gpuCanvas: document.createElement('canvas'),
    });
    const gpuDraw = vi
      .spyOn(backend as unknown as { drawGpuItems: () => void }, 'drawGpuItems')
      .mockImplementation(() => {
        throw new Error('simulated command encoder failure');
      });

    expect(() =>
      backend.drawVectorItems([FIXTURE_ITEMS[0]!, FIXTURE_ITEMS[2]!, FIXTURE_ITEMS[0]!]),
    ).not.toThrow();
    backend.endFrame();
    expect(gpuDraw).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(3);
    expect(replay).toHaveBeenNthCalledWith(1, [FIXTURE_ITEMS[0]], undefined, undefined);
    expect(replay).toHaveBeenNthCalledWith(2, [FIXTURE_ITEMS[2]], undefined, undefined);
    expect(replay).toHaveBeenNthCalledWith(3, [FIXTURE_ITEMS[0]], undefined, undefined);
    expect(backend.getDiagnostics()).toMatchObject({
      gpuActive: false,
      initFailureReason: 'WebGPU draw failed',
      lastFrameGpuItems: 0,
      fallbackIslandCount: 3,
      fallbackReasons: { 'gpu-draw-failed': 2 },
    });
    expect(destroyDevice).toHaveBeenCalledTimes(1);
    backend.destroy();
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

  /**
   * jsdom has neither the WebGPU enum globals the pipeline code references
   * nor a webgpu canvas context; provide the minimum for initGpuResources to
   * complete. The adapter mock hands out one device per init generation on
   * the high-performance preference only — the selector also probes
   * low-power, which must not consume the replacement device.
   */
  function mockWebGpuEnvironment(
    devices: Array<
      GPUDevice & { resolveLost: (info: { reason: string; message: string }) => void }
    >,
  ): () => void {
    const realGetContext = HTMLCanvasElement.prototype.getContext;
    type GetContext = typeof realGetContext;
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (
        this: HTMLCanvasElement,
        ...args: unknown[]
      ): RenderingContext | null {
        if (args[0] === 'webgpu') {
          return { configure: vi.fn() } as unknown as RenderingContext;
        }
        return (realGetContext as (...a: unknown[]) => RenderingContext | null).apply(this, args);
      } as unknown as GetContext);
    const globalScope = globalThis as unknown as Record<string, unknown>;
    const hadEnums = 'GPUBufferUsage' in globalScope;
    const previousEnums = { buffer: globalScope.GPUBufferUsage, stage: globalScope.GPUShaderStage };
    globalScope.GPUBufferUsage ??= { UNIFORM: 0x40, COPY_DST: 0x08 };
    globalScope.GPUShaderStage ??= { VERTEX: 0x1 };

    const queue = [...devices];
    const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async (options?: { powerPreference?: string }) => {
          if (options?.powerPreference !== 'high-performance') return null;
          const device = queue.shift();
          if (!device) return null;
          return {
            info: { vendor: 'varve-test', device: 'Test GPU' },
            requestDevice: async () => device,
          };
        },
        getPreferredCanvasFormat: () => 'rgba8unorm',
      },
    });

    return () => {
      getContextSpy.mockRestore();
      if (hadEnums) {
        globalScope.GPUBufferUsage = previousEnums.buffer;
        globalScope.GPUShaderStage = previousEnums.stage;
      } else {
        delete globalScope.GPUBufferUsage;
        delete globalScope.GPUShaderStage;
      }
      Object.defineProperty(navigator, 'gpu', { configurable: true, value: originalGpu });
    };
  }

  function makeMockDevice(): GPUDevice & {
    resolveLost: (info: { reason: string; message: string }) => void;
  } {
    let resolveLost: (info: { reason: string; message: string }) => void = () => {};
    const lost = new Promise<{ reason: string; message: string }>((resolve) => {
      resolveLost = resolve;
    });
    return {
      lost,
      resolveLost,
      destroy: vi.fn(),
      limits: { maxBufferSize: 256 * 1024 * 1024 },
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
    } as unknown as GPUDevice & {
      resolveLost: (info: { reason: string; message: string }) => void;
    };
  }

  it('recovers the GPU side in place after a simulated runtime device loss', async () => {
    const first = makeMockDevice();
    const second = makeMockDevice();
    const restore = mockWebGpuEnvironment([first, second]);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const wgpu = new WebGPUBackend();
      await wgpu.init(canvas);
      expect(wgpu.getDiagnostics().gpuActive, wgpu.getDiagnostics().initFailureReason).toBe(true);

      let recovered = 0;
      wgpu.onRecovered = () => {
        recovered++;
      };

      first.resolveLost({ reason: 'unknown', message: 'simulated device loss' });
      await vi.waitFor(() => {
        expect(recovered).toBe(1);
      });

      const diag = wgpu.getDiagnostics();
      expect(diag.gpuActive).toBe(true);
      expect(diag.deviceLost).toBe(false);
      // The lost device is destroyed; the replacement stays live.
      expect(second.destroy).not.toHaveBeenCalled();
      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(wgpu.presentCanvasHas2dContext()).toBe(true);
      wgpu.destroy();
    } finally {
      restore();
    }
  });

  it('a failed recovery leaves the honest Canvas2D fallback status', async () => {
    const first = makeMockDevice();
    const restore = mockWebGpuEnvironment([first]);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const wgpu = new WebGPUBackend();
      await wgpu.init(canvas);
      expect(wgpu.getDiagnostics().gpuActive, wgpu.getDiagnostics().initFailureReason).toBe(true);

      first.resolveLost({ reason: 'unknown', message: 'simulated device loss' });
      await vi.waitFor(() => {
        const diag = wgpu.getDiagnostics();
        expect(diag.deviceLost).toBe(true);
        expect(diag.gpuActive).toBe(false);
        expect(diag.initFailureReason).toContain('WebGPU adapter unavailable');
      });
      expect(wgpu.presentCanvasHas2dContext()).toBe(true);
      wgpu.destroy();
    } finally {
      restore();
    }
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
