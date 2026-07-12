/// <reference types="@webgpu/types" />

import type { RenderItem } from '@strata/engine';
/**
 * WebGPU compositor backend — solid fills for rect/circle/line with Canvas2D fallback.
 * Lines are tessellated as thin quads; circles get a dedicated discard shader.
 * Uses explicit pipeline layouts and a vertex buffer ring pool.
 */
import { selectWebGpuAdapter } from '@strata/engine';
import { computeFloatingOrigin } from '@strata/shared';
import { Canvas2DBackend } from '../canvas2d/backend';
import type { CompositorDiagnostics, CompositorFrame } from '../types';
import {
  BLIT_FRAGMENT_WGSL,
  BLIT_VERTEX_WGSL,
  CIRCLE_FRAGMENT_WGSL,
  CIRCLE_VERTEX_WGSL,
  SOLID_FRAGMENT_WGSL,
  SOLID_VERTEX_WGSL,
} from './shaders';

type BeginOpts = { applyCamera?: boolean; clear?: boolean };

interface GpuVertex {
  localPos: [number, number];
  color: [number, number, number, number];
  transform: [number, number, number, number];
  transform2: [number, number];
}

const LINE_HALF_WIDTH = 1.5;

function fillToRgba(fill: RenderItem['fill']): [number, number, number, number] {
  if (fill && typeof fill === 'object' && 'space' in fill && fill.space === 'rgb') {
    return [fill.r / 255, fill.g / 255, fill.b / 255, fill.a / 255];
  }
  if (Array.isArray(fill)) {
    return [fill[0] / 255, fill[1] / 255, fill[2] / 255, fill[3] / 255];
  }
  return [0, 0, 0, 1];
}

function buildVertices(items: RenderItem[]): GpuVertex[] {
  const vertices: GpuVertex[] = [];
  for (const item of items) {
    const c = fillToRgba(item.fill);
    const col: [number, number, number, number] = [c[0], c[1], c[2], c[3] * (item.opacity ?? 1)];
    const t = item.transform;
    const transform: [number, number, number, number] = [t[0], t[1], t[2], t[3]];
    const transform2: [number, number] = [t[4], t[5]];
    const prim = item.primitive;
    if (prim.kind === 'rect') {
      const pts: [number, number][] = [
        [prim.x, prim.y],
        [prim.x + prim.w, prim.y],
        [prim.x, prim.y + prim.h],
        [prim.x + prim.w, prim.y],
        [prim.x, prim.y + prim.h],
        [prim.x + prim.w, prim.y + prim.h],
      ];
      for (const p of pts) vertices.push({ localPos: p, color: col, transform, transform2 });
    } else if (prim.kind === 'circle') {
      const cx = prim.cx;
      const cy = prim.cy;
      const r = prim.r;
      const segs = 32;
      for (let i = 0; i < segs; i++) {
        const a0 = (2 * Math.PI * i) / segs;
        const a1 = (2 * Math.PI * (i + 1)) / segs;
        vertices.push(
          { localPos: [cx, cy], color: col, transform, transform2 },
          {
            localPos: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
            color: col,
            transform,
            transform2,
          },
          {
            localPos: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)],
            color: col,
            transform,
            transform2,
          },
        );
      }
    } else if (prim.kind === 'line') {
      const dx = prim.to[0] - prim.from[0];
      const dy = prim.to[1] - prim.from[1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const hw = LINE_HALF_WIDTH;
      const p1: [number, number] = [prim.from[0] + nx * hw, prim.from[1] + ny * hw];
      const p2: [number, number] = [prim.from[0] - nx * hw, prim.from[1] - ny * hw];
      const p3: [number, number] = [prim.to[0] + nx * hw, prim.to[1] + ny * hw];
      const p4: [number, number] = [prim.to[0] - nx * hw, prim.to[1] - ny * hw];
      for (const p of [p1, p2, p3, p2, p4, p3]) {
        vertices.push({ localPos: p, color: col, transform, transform2 });
      }
    }
  }
  return vertices;
}

function isGpuPrimitive(item: RenderItem): boolean {
  const k = item.primitive.kind;
  return k === 'rect' || k === 'circle' || k === 'line';
}

/** Test helper: line tessellation produces 6 vertices (2 triangles). */
export function lineTessellationVertexCount(item: RenderItem): number {
  if (item.primitive.kind !== 'line') return 0;
  return buildVertices([item]).length;
}

/** Return the smallest power of 2 >= n, clamped to 256 minimum. */
function roundUpPow2(n: number): number {
  if (n <= 256) return 256;
  return 1 << (32 - Math.clz32(n - 1));
}

export class WebGPUBackend {
  readonly id = 'webgpu' as const;
  private fallback: Canvas2DBackend | null = null;
  /** Offscreen 2D surface for non-GPU primitives when WebGPU owns the main canvas. */
  private fallbackSurface: OffscreenCanvas | null = null;
  private deviceLostHandler: (() => Promise<void>) | null = null;
  private gpuReady = false;
  private adapterIsFallback = false;
  private deviceLost = false;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'rgba8unorm';
  private solidPipeline: GPURenderPipeline | null = null;
  private circlePipeline: GPURenderPipeline | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private cameraBuffer: GPUBuffer | null = null;
  private circleUniformBuffer: GPUBuffer | null = null;
  private blitUniformBuffer: GPUBuffer | null = null;
  private cameraBindGroup: GPUBindGroup | null = null;
  private circleBindGroup: GPUBindGroup | null = null;
  private blitBindGroupLayout: GPUBindGroupLayout | null = null;
  private blitSampler: GPUSampler | null = null;
  private vertexPool: Map<number, GPUBuffer> = new Map();
  private bundleCache: Map<string, GPURenderBundle> = new Map();
  private currentFrame: CompositorFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lastFrameVertexBytes = 0;
  private pipelineInitMs = 0;
  private needsFallbackComposite = false;
  private frameCleared = false;
  private gpuDrawnThisFrame = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.fallback = new Canvas2DBackend();

    // Acquire WebGPU context BEFORE any 2D context on the main canvas.
    try {
      const gpu = navigator.gpu;
      if (!gpu) throw new Error('WebGPU unavailable');
      // Try high-performance first, fall back to low-power (integrated GPU) —
      // covers laptops and mixed-GPU systems where requesting the discrete
      // GPU alone may fail (e.g. no discrete GPU present). Declines a
      // software-emulated adapter (e.g. SwiftShader) rather than accepting
      // degraded-but-technically-functional GPU mode: the hand-tuned
      // Canvas2D path outperforms software-rendered WebGPU (ADR-0003
      // Minimum Supported Baseline).
      const selection = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
      if (selection.kind === 'declined-software') {
        // `adapterIsFallback` stays true so diagnostics can distinguish
        // "declined software adapter" from "no WebGPU at all".
        this.adapterIsFallback = true;
        throw new Error('WebGPU adapter is software-emulated; declining in favor of Canvas2D');
      }
      if (selection.kind === 'unavailable') throw new Error('No WebGPU adapter');
      const { adapter } = selection;
      const device = await adapter.requestDevice();
      const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!context) {
        device.destroy();
        throw new Error('WebGPU canvas context unavailable');
      }
      this.format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format: this.format, alphaMode: 'premultiplied' });

      // Measured separately from WASM init latency (see docs/architecture/render-pipeline.md) —
      // shader/pipeline compilation is frequently the larger, more variable contributor to
      // first-frame latency. No persistent cross-launch cache exists for this: the WebGPU
      // spec has no application-facing pipeline-cache API (only an opaque, implementation-
      // internal browser cache); that's a native-wgpu-only capability this browser-facing
      // backend can't reach. See ADR-0003.
      const pipelineInitStart = performance.now();

      const solidModule = device.createShaderModule({
        code: `${SOLID_VERTEX_WGSL}\n${SOLID_FRAGMENT_WGSL}`,
      });
      const circleModule = device.createShaderModule({
        code: `${CIRCLE_VERTEX_WGSL}\n${CIRCLE_FRAGMENT_WGSL}`,
      });
      const blitModule = device.createShaderModule({
        code: `${BLIT_VERTEX_WGSL}\n${BLIT_FRAGMENT_WGSL}`,
      });

      const vertexBufferLayout: GPUVertexBufferLayout = {
        arrayStride: 48,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x4' },
          { shaderLocation: 2, offset: 24, format: 'float32x4' },
          { shaderLocation: 3, offset: 40, format: 'float32x2' },
        ],
      };

      const solidBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'uniform' },
          },
        ],
      });

      const circleBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'uniform' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      });

      const blitBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'uniform' },
          },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      });

      const solidPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [solidBindGroupLayout],
      });

      const circlePipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [circleBindGroupLayout],
      });

      const blitPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [blitBindGroupLayout],
      });

      const solidPipeline = device.createRenderPipeline({
        layout: solidPipelineLayout,
        vertex: { module: solidModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: solidModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      const circlePipeline = device.createRenderPipeline({
        layout: circlePipelineLayout,
        vertex: { module: circleModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: circleModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      const blitPipeline = device.createRenderPipeline({
        layout: blitPipelineLayout,
        vertex: { module: blitModule, entryPoint: 'vs_main' },
        fragment: {
          module: blitModule,
          entryPoint: 'fs_main',
          targets: [
            {
              format: this.format,
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list' },
      });

      this.pipelineInitMs = performance.now() - pipelineInitStart;

      const cameraBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const circleUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const blitUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const cameraBindGroup = device.createBindGroup({
        layout: solidBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
      });
      const circleBg = device.createBindGroup({
        layout: circleBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: cameraBuffer } },
          { binding: 1, resource: { buffer: circleUniformBuffer } },
        ],
      });
      const blitSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

      this.device = device;
      this.context = context;
      this.solidPipeline = solidPipeline;
      this.circlePipeline = circlePipeline;
      this.blitPipeline = blitPipeline;
      this.cameraBuffer = cameraBuffer;
      this.circleUniformBuffer = circleUniformBuffer;
      this.blitUniformBuffer = blitUniformBuffer;
      this.cameraBindGroup = cameraBindGroup;
      this.circleBindGroup = circleBg;
      this.blitBindGroupLayout = blitBindGroupLayout;
      this.blitSampler = blitSampler;
      this.gpuReady = true;
      this.watchDeviceLost(device);
    } catch {
      this.gpuReady = false;
    }

    if (this.gpuReady) {
      const dpr = window.devicePixelRatio || 1;
      this.fallbackSurface = new OffscreenCanvas(
        Math.max(1, Math.floor((canvas.width || 1) * dpr)),
        Math.max(1, Math.floor((canvas.height || 1) * dpr)),
      );
      await this.fallback.init(this.fallbackSurface);
    } else {
      await this.fallback.init(canvas);
    }
  }

  beginFrame(frame: CompositorFrame, opts?: BeginOpts): void {
    this.currentFrame = frame;
    this.needsFallbackComposite = false;
    this.frameCleared = false;
    this.gpuDrawnThisFrame = false;
    if (!this.gpuReady) {
      this.fallback?.beginFrame(frame, opts);
      return;
    }
    const { viewport } = frame;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(viewport.width * dpr));
    const h = Math.max(1, Math.floor(viewport.height * dpr));
    if (this.canvas && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (
      this.fallbackSurface &&
      (this.fallbackSurface.width !== w || this.fallbackSurface.height !== h)
    ) {
      this.fallbackSurface.width = w;
      this.fallbackSurface.height = h;
    }
  }

  drawVectorItems(items: RenderItem[]): void {
    if (!items.length) return;
    const gpuItems = items.filter(isGpuPrimitive);
    const fallbackItems = items.filter((i) => !isGpuPrimitive(i));
    if (
      this.gpuReady &&
      this.device &&
      this.context &&
      this.solidPipeline &&
      this.circlePipeline &&
      this.cameraBuffer &&
      this.circleUniformBuffer &&
      this.cameraBindGroup &&
      this.circleBindGroup
    ) {
      const frame = this.currentFrame;
      if (frame && gpuItems.length > 0) {
        this.drawGpuItems(gpuItems, frame);
        this.gpuDrawnThisFrame = true;
      }
      if (fallbackItems.length > 0 && this.fallback) {
        this.fallback.beginFrame(frame ?? this.currentFrame!, {
          applyCamera: true,
          clear: true,
        });
        this.fallback.drawVectorItems(fallbackItems);
        this.fallback.endFrame();
        this.needsFallbackComposite = true;
      }
    } else {
      this.fallback?.drawVectorItems(items);
      return;
    }
  }

  compositeRasterLayer(
    id: string,
    bitmap: ImageBitmap,
    transform: readonly [number, number, number, number, number, number],
    blendMode: string,
  ): void {
    this.fallback?.compositeRasterLayer(id, bitmap, transform, blendMode);
  }

  endFrame(): void {
    if (this.gpuReady && this.needsFallbackComposite) {
      this.compositeFallbackOverlay();
    }
    this.currentFrame = null;
    if (!this.gpuReady) {
      this.fallback?.endFrame();
    }
  }

  getDiagnostics(): CompositorDiagnostics {
    return {
      backendId: 'webgpu',
      gpuActive: this.gpuReady,
      vertexPoolEntries: this.vertexPool.size,
      bundleCacheEntries: this.bundleCache.size,
      lastFrameVertexBytes: this.lastFrameVertexBytes,
      adapterIsFallback: this.adapterIsFallback,
      pipelineInitMs: this.pipelineInitMs,
      deviceLost: this.deviceLost,
    };
  }

  destroy(): void {
    this.device?.destroy();
    this.device = null;
    this.context = null;
    this.solidPipeline = null;
    this.circlePipeline = null;
    this.blitPipeline = null;
    this.cameraBuffer = null;
    this.circleUniformBuffer = null;
    this.blitUniformBuffer = null;
    this.cameraBindGroup = null;
    this.circleBindGroup = null;
    this.blitBindGroupLayout = null;
    this.blitSampler = null;
    for (const buf of this.vertexPool.values()) buf.destroy();
    this.vertexPool.clear();
    this.bundleCache.clear();
    this.gpuReady = false;
    this.fallback?.destroy();
    this.fallback = null;
    this.fallbackSurface = null;
    this.canvas = null;
  }

  set onDeviceLost(handler: (() => Promise<void>) | undefined) {
    this.deviceLostHandler = handler ?? null;
  }

  watchDeviceLost(device: GPUDevice): void {
    void device.lost.then(async () => {
      this.gpuReady = false;
      this.deviceLost = true;
      this.device = null;
      for (const buf of this.vertexPool.values()) buf.destroy();
      this.vertexPool.clear();
      this.bundleCache.clear();
      if (this.deviceLostHandler) await this.deviceLostHandler();
    });
  }

  private getOrCreateVertexBuffer(device: GPUDevice, byteSize: number): GPUBuffer {
    const rounded = roundUpPow2(byteSize);
    let buf = this.vertexPool.get(rounded);
    if (!buf) {
      buf = device.createBuffer({
        size: rounded,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.vertexPool.set(rounded, buf);
    }
    return buf;
  }

  private hashVertices(data: Float32Array): string {
    let h = 0x811c9dc5 >>> 0;
    h ^= data.length >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v === undefined) break;
      h ^= Math.abs((v * 0x9e3779b9) | 0) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${data.length}:${data.byteLength}:${h.toString(16)}`;
  }

  /** Test accessor for vertex pool reuse assertions. */
  getOrCreateVertexBufferForTest(byteSize: number): GPUBuffer | null {
    if (!this.device) return null;
    return this.getOrCreateVertexBuffer(this.device, byteSize);
  }

  private compositeFallbackOverlay(): void {
    const device = this.device;
    const context = this.context;
    const blitPipeline = this.blitPipeline;
    const blitBindGroupLayout = this.blitBindGroupLayout;
    const blitSampler = this.blitSampler;
    const blitUniformBuffer = this.blitUniformBuffer;
    const surface = this.fallbackSurface;
    const frame = this.currentFrame;
    if (
      !device ||
      !context ||
      !blitPipeline ||
      !blitBindGroupLayout ||
      !blitSampler ||
      !blitUniformBuffer ||
      !surface ||
      !frame
    ) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(frame.viewport.width * dpr));
    const h = Math.max(1, Math.floor(frame.viewport.height * dpr));
    const overlayTexture = device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: surface },
      { texture: overlayTexture },
      { width: w, height: h },
    );
    const blitUniform = new Float32Array([frame.viewport.width, frame.viewport.height, 0, 0]);
    device.queue.writeBuffer(blitUniformBuffer, 0, blitUniform);
    const bindGroup = device.createBindGroup({
      layout: blitBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: blitUniformBuffer } },
        { binding: 1, resource: blitSampler },
        { binding: 2, resource: overlayTexture.createView() },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: this.gpuDrawnThisFrame ? 'load' : 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(blitPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    overlayTexture.destroy();
  }

  private drawGpuItems(items: RenderItem[], frame: CompositorFrame): void {
    const device = this.device;
    const context = this.context;
    const solidPipeline = this.solidPipeline;
    const circlePipeline = this.circlePipeline;
    const cameraBuffer = this.cameraBuffer;
    const circleUniformBuffer = this.circleUniformBuffer;
    const cameraBindGroup = this.cameraBindGroup;
    const circleBindGroup = this.circleBindGroup;
    if (
      !device ||
      !context ||
      !solidPipeline ||
      !circlePipeline ||
      !cameraBuffer ||
      !circleUniformBuffer ||
      !cameraBindGroup ||
      !circleBindGroup
    )
      return;

    const solidItems = items.filter((i) => i.primitive.kind !== 'circle');
    const circleItems = items.filter((i) => i.primitive.kind === 'circle');

    const camera = frame.camera;
    const viewport = frame.viewport;
    const origin = computeFloatingOrigin(camera, viewport);
    // WGSL CameraUniform layout: pan(8) + zoom(4) + viewportW(4) + viewportH(4) + pad(4) + origin(8) = 32 bytes
    const cam = new Float32Array([
      camera.pan.x,
      camera.pan.y,
      camera.zoom,
      viewport.width,
      viewport.height,
      0,
      origin[0],
      origin[1],
    ]);
    device.queue.writeBuffer(cameraBuffer, 0, cam);

    const textureView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    let firstPass = !this.frameCleared;

    // Solid items (rect + line) — render bundles with fresh vertex upload each frame
    if (solidItems.length > 0) {
      const solidVerts = buildVertices(solidItems);
      if (solidVerts.length > 0) {
        const data = flattenVertices(solidVerts);
        this.lastFrameVertexBytes = data.byteLength;
        const hash = this.hashVertices(data);
        const vBuf = this.getOrCreateVertexBuffer(device, data.byteLength);
        device.queue.writeBuffer(vBuf, 0, data.buffer.slice(0, data.byteLength) as ArrayBuffer);
        let bundle = this.bundleCache.get(hash);
        if (!bundle) {
          const bundleEncoder = device.createRenderBundleEncoder({
            colorFormats: [this.format],
          });
          bundleEncoder.setPipeline(solidPipeline);
          bundleEncoder.setBindGroup(0, cameraBindGroup);
          bundleEncoder.setVertexBuffer(0, vBuf);
          bundleEncoder.draw(solidVerts.length);
          bundle = bundleEncoder.finish();
          this.bundleCache.set(hash, bundle);
          if (this.bundleCache.size > 32) {
            const key = this.bundleCache.keys().next().value;
            if (key) this.bundleCache.delete(key);
          }
        }
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: textureView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: firstPass ? 'clear' : 'load',
              storeOp: 'store',
            },
          ],
        });
        firstPass = false;
        this.frameCleared = true;
        pass.executeBundles([bundle]);
        pass.end();
      }
    }

    // Circle items — per-circle draw (uniform varies per primitive; no bundle cache)
    for (const circleItem of circleItems) {
      const circleVerts = buildVertices([circleItem]);
      if (circleVerts.length === 0) continue;
      const prim = circleItem.primitive;
      if (prim.kind !== 'circle') continue;
      const t = circleItem.transform;
      const origin = computeFloatingOrigin(camera, frame.viewport);
      // Match the vertex shader's (world - origin) * zoom + pan convention.
      const worldCx = t[0] * prim.cx + t[2] * prim.cy + t[4];
      const worldCy = t[1] * prim.cx + t[3] * prim.cy + t[5];
      const screenCx = (worldCx - origin[0]) * camera.zoom + camera.pan.x;
      const screenCy = (worldCy - origin[1]) * camera.zoom + camera.pan.y;
      const screenR = prim.r * camera.zoom;
      const circleData = new Float32Array([screenCx, screenCy, screenR, 0]);
      device.queue.writeBuffer(circleUniformBuffer, 0, circleData.buffer as ArrayBuffer);
      const data = flattenVertices(circleVerts);
      this.lastFrameVertexBytes += data.byteLength;
      const vBuf = this.getOrCreateVertexBuffer(device, data.byteLength);
      device.queue.writeBuffer(vBuf, 0, data.buffer.slice(0, data.byteLength) as ArrayBuffer);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: firstPass ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      });
      firstPass = false;
      this.frameCleared = true;
      pass.setPipeline(circlePipeline);
      pass.setBindGroup(0, circleBindGroup);
      pass.setVertexBuffer(0, vBuf);
      pass.draw(circleVerts.length);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
  }
}

function flattenVertices(vertices: GpuVertex[]): Float32Array {
  const data = new Float32Array(vertices.length * 12);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (!v) continue;
    const o = i * 12;
    data[o] = v.localPos[0];
    data[o + 1] = v.localPos[1];
    data[o + 2] = v.color[0];
    data[o + 3] = v.color[1];
    data[o + 4] = v.color[2];
    data[o + 5] = v.color[3];
    data[o + 6] = v.transform[0];
    data[o + 7] = v.transform[1];
    data[o + 8] = v.transform[2];
    data[o + 9] = v.transform[3];
    data[o + 10] = v.transform2[0];
    data[o + 11] = v.transform2[1];
  }
  return data;
}
