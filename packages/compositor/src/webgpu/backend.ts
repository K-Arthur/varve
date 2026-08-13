/// <reference types="@webgpu/types" />

import type { RenderItem } from '@varve/engine';
/**
 * WebGPU compositor backend — solid fills for rect/circle/line.
 *
 * Canvas ownership (2026-07-13): the *present* canvas stays Canvas2D so
 * CanvasArea.drawContent (board fill, camera, structural masks, partial
 * redraw) keeps working. GPU work targets an offscreen `<canvas>` with a
 * `webgpu` context; results are `drawImage`'d onto the 2D present surface
 * with an identity transform. This also makes device-loss recoverable
 * in-place (drop GPU, keep 2D) — a browser canvas's context type is fixed
 * for its lifetime, so the prior "steal webgpu on the content canvas"
 * design could never fall back without a full remount/reload.
 *
 * Lines are tessellated as thin quads; circles use a discard shader.
 * Explicit pipeline layouts + vertex buffer ring pool.
 */
import { selectWebGpuAdapter } from '@varve/engine';
import { computeFloatingOrigin, managedColorToRgba } from '@varve/shared';
import { Canvas2DBackend } from '../canvas2d/backend';
import { buildStructuralRenderPlan } from '../structuralRenderPlan';
import type { CompositorDiagnostics, CompositorFrame } from '../types';
import {
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

const PREMUL_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

function fillToRgba(fill: RenderItem['fill']): [number, number, number, number] {
  if (fill && typeof fill === 'object' && 'space' in fill) {
    if (fill.space === 'rgb') {
      return [fill.r / 255, fill.g / 255, fill.b / 255, fill.a / 255];
    }
    // For CMYK/Gray/Spot, convert via shared colour pipeline
    try {
      const [r, g, b, a] = managedColorToRgba(fill);

      return [r / 255, g / 255, b / 255, a / 255];
    } catch {
      return [0, 0, 0, 1];
    }
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
  return k === 'rect' || k === 'circle';
}

/**
 * The current WebGPU pipelines only reproduce a single solid fill on a rect
 * or circle. Keep this predicate deliberately fail-closed: routing a richer
 * item to the GPU would silently drop paint-stack, stroke, effect, filter, or
 * blend semantics. A whole batch must be supported because splitting it into
 * GPU and Canvas2D partitions changes z-order when the two kinds interleave.
 */
export function isGpuBatchSupported(items: readonly RenderItem[]): boolean {
  const primitiveKinds = new Set(items.map((item) => item.primitive.kind));
  return (
    items.every(
      (item) =>
        isGpuPrimitive(item) &&
        (item.fills?.length ?? 0) === 0 &&
        (item.strokes?.length ?? 0) === 0 &&
        (item.effects?.length ?? 0) === 0 &&
        (item.filters?.length ?? 0) === 0 &&
        (item.blendMode === undefined || item.blendMode === 'normal'),
    ) && primitiveKinds.size <= 1
  );
}

/** Test helper: line tessellation produces 6 vertices (2 triangles). */
export function lineTessellationVertexCount(item: RenderItem): number {
  if (item.primitive.kind !== 'line') return 0;
  return buildVertices([item]).length;
}

/**
 * Apply item affine to a local point — same convention as SOLID_VERTEX_WGSL
 * and `@varve/shared` `applyAffine` (`x'=a·x+c·y+e`, `y'=b·x+d·y+f`).
 */
export function applyItemAffine(
  localPos: readonly [number, number],
  transform: readonly [number, number, number, number, number, number],
): [number, number] {
  const [a, b, c, d, e, f] = transform;
  const [x, y] = localPos;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Return the smallest power of 2 >= n, clamped to 256 minimum. */
function roundUpPow2(n: number): number {
  if (n <= 256) return 256;
  return 1 << (32 - Math.clz32(n - 1));
}

function worldToScreenCss(
  worldX: number,
  worldY: number,
  camera: CompositorFrame['camera'],
  viewport: CompositorFrame['viewport'],
  origin: readonly [number, number],
): [number, number] {
  const zoomedX = (worldX - origin[0]) * camera.zoom;
  const zoomedY = (worldY - origin[1]) * camera.zoom;
  const cx = viewport.width * 0.5;
  const cy = viewport.height * 0.5;
  const dx = zoomedX - cx;
  const dy = zoomedY - cy;
  const r = camera.rotation ?? 0;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cx + camera.pan.x + dx * cos - dy * sin, cy + camera.pan.y + dx * sin + dy * cos];
}

export class WebGPUBackend {
  readonly id = 'webgpu' as const;
  /** Always owns the present (content) canvas via Canvas2D. */
  private present: Canvas2DBackend | null = null;
  private deviceLostHandler: (() => Promise<void>) | null = null;
  private gpuReady = false;
  private adapterIsFallback = false;
  private deviceLost = false;
  private device: GPUDevice | null = null;
  /** Offscreen canvas that holds the `webgpu` context — never the present canvas. */
  private gpuCanvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'rgba8unorm';
  private solidPipeline: GPURenderPipeline | null = null;
  private circlePipeline: GPURenderPipeline | null = null;
  private cameraBuffer: GPUBuffer | null = null;
  private circleUniformBuffer: GPUBuffer | null = null;
  private cameraBindGroup: GPUBindGroup | null = null;
  private circleBindGroup: GPUBindGroup | null = null;
  private vertexPool: Map<number, GPUBuffer> = new Map();
  private bundleCache: Map<string, GPURenderBundle> = new Map();
  private currentFrame: CompositorFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lastFrameVertexBytes = 0;
  private pipelineInitMs = 0;
  private gpuDrawnThisFrame = false;
  private fallbackIslandCount = 0;
  private fallbackNodeCount = 0;
  private fallbackReasons: Record<string, number> = {};

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    // Present surface is ALWAYS Canvas2D on the content canvas — see file header.
    this.present = new Canvas2DBackend();
    await this.present.init(canvas);

    try {
      const gpu = navigator.gpu;
      if (!gpu) throw new Error('WebGPU unavailable');
      const selection = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
      if (selection.kind === 'declined-software') {
        this.adapterIsFallback = true;
        throw new Error('WebGPU adapter is software-emulated; declining in favor of Canvas2D');
      }
      if (selection.kind === 'unavailable') throw new Error('No WebGPU adapter');
      const { adapter } = selection;
      const device = await adapter.requestDevice();

      const gpuCanvas = document.createElement('canvas');
      gpuCanvas.width = Math.max(1, canvas.width || 1);
      gpuCanvas.height = Math.max(1, canvas.height || 1);
      const context = gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!context) {
        device.destroy();
        throw new Error('WebGPU canvas context unavailable');
      }
      this.format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format: this.format, alphaMode: 'premultiplied' });

      const pipelineInitStart = performance.now();

      const solidModule = device.createShaderModule({
        code: `${SOLID_VERTEX_WGSL}\n${SOLID_FRAGMENT_WGSL}`,
      });
      const circleModule = device.createShaderModule({
        code: `${CIRCLE_VERTEX_WGSL}\n${CIRCLE_FRAGMENT_WGSL}`,
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

      const solidPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [solidBindGroupLayout],
      });
      const circlePipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [circleBindGroupLayout],
      });

      const colorTarget: GPUColorTargetState = {
        format: this.format,
        blend: PREMUL_BLEND,
      };

      const solidPipeline = device.createRenderPipeline({
        layout: solidPipelineLayout,
        vertex: { module: solidModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: solidModule,
          entryPoint: 'fs_main',
          targets: [colorTarget],
        },
        primitive: { topology: 'triangle-list' },
      });

      const circlePipeline = device.createRenderPipeline({
        layout: circlePipelineLayout,
        vertex: { module: circleModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: circleModule,
          entryPoint: 'fs_main',
          targets: [colorTarget],
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

      this.device = device;
      this.gpuCanvas = gpuCanvas;
      this.context = context;
      this.solidPipeline = solidPipeline;
      this.circlePipeline = circlePipeline;
      this.cameraBuffer = cameraBuffer;
      this.circleUniformBuffer = circleUniformBuffer;
      this.cameraBindGroup = cameraBindGroup;
      this.circleBindGroup = circleBg;
      this.gpuReady = true;
      this.watchDeviceLost(device);
    } catch {
      this.gpuReady = false;
      this.teardownGpuOnly();
    }
  }

  beginFrame(frame: CompositorFrame, opts?: BeginOpts): void {
    this.currentFrame = frame;
    this.gpuDrawnThisFrame = false;
    this.fallbackIslandCount = 0;
    this.fallbackNodeCount = 0;
    this.fallbackReasons = {};
    const { viewport } = frame;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(viewport.width * dpr));
    const h = Math.max(1, Math.floor(viewport.height * dpr));
    if (this.canvas && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.gpuCanvas && (this.gpuCanvas.width !== w || this.gpuCanvas.height !== h)) {
      this.gpuCanvas.width = w;
      this.gpuCanvas.height = h;
      if (this.device && this.context) {
        this.context.configure({
          device: this.device,
          format: this.format,
          alphaMode: 'premultiplied',
        });
      }
    }
    // Present path always goes through Canvas2D beginFrame so camera/clear
    // semantics stay shared with the pure-2D backend when GPU is down.
    this.present?.beginFrame(frame, opts);
  }

  drawVectorItems(items: RenderItem[]): void {
    if (!items.length) return;
    if (
      this.gpuReady &&
      this.device &&
      this.context &&
      this.solidPipeline &&
      this.circlePipeline &&
      this.cameraBuffer &&
      this.circleUniformBuffer &&
      this.cameraBindGroup &&
      this.circleBindGroup &&
      this.gpuCanvas
    ) {
      const frame = this.currentFrame;
      if (frame) {
        const plan = buildStructuralRenderPlan(items, frame.structure);
        this.fallbackIslandCount += plan.fallbackIslandCount;
        this.fallbackNodeCount += plan.fallbackNodeCount;
        for (const [reason, count] of Object.entries(plan.fallbackReasons)) {
          this.fallbackReasons[reason] = (this.fallbackReasons[reason] ?? 0) + count;
        }
        for (const segment of plan.segments) {
          if (segment.kind === 'webgpu-run' && isGpuBatchSupported(segment.items)) {
            this.drawGpuItems([...segment.items], frame);
            this.gpuDrawnThisFrame = true;
            this.blitGpuToPresent();
          } else {
            // Keep the complete semantic island on Canvas2D. No backend
            // partition is allowed to reorder the compositor's paint order.
            this.present?.drawVectorItems([...segment.items]);
          }
        }
      }
      return;
    }
    this.present?.drawVectorItems(items);
  }

  compositeRasterLayer(
    id: string,
    bitmap: ImageBitmap,
    transform: readonly [number, number, number, number, number, number],
    blendMode: string,
  ): void {
    this.present?.compositeRasterLayer(id, bitmap, transform, blendMode);
  }

  endFrame(): void {
    this.present?.endFrame();
    this.currentFrame = null;
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
      fallbackIslandCount: this.fallbackIslandCount,
      fallbackNodeCount: this.fallbackNodeCount,
      fallbackReasons: { ...this.fallbackReasons },
    };
  }

  destroy(): void {
    this.teardownGpuOnly();
    this.present?.destroy();
    this.present = null;
    this.canvas = null;
  }

  set onDeviceLost(handler: (() => Promise<void>) | undefined) {
    this.deviceLostHandler = handler ?? null;
  }

  watchDeviceLost(device: GPUDevice): void {
    void device.lost.then(async () => {
      this.deviceLost = true;
      // In-place recovery: present canvas was always 2D, so dropping GPU
      // leaves a working Canvas2D path. No remount/reload required.
      this.teardownGpuOnly();
      this.gpuReady = false;
      if (this.deviceLostHandler) await this.deviceLostHandler();
    });
  }

  /** True when the present canvas still exposes a 2D context after init. */
  presentCanvasHas2dContext(): boolean {
    if (!this.canvas) return false;
    return this.canvas.getContext('2d') !== null;
  }

  /** Test accessor for vertex pool reuse assertions. */
  getOrCreateVertexBufferForTest(byteSize: number): GPUBuffer | null {
    if (!this.device) return null;
    return this.getOrCreateVertexBuffer(this.device, byteSize);
  }

  private teardownGpuOnly(): void {
    this.device?.destroy();
    this.device = null;
    this.context = null;
    this.gpuCanvas = null;
    this.solidPipeline = null;
    this.circlePipeline = null;
    this.cameraBuffer = null;
    this.circleUniformBuffer = null;
    this.cameraBindGroup = null;
    this.circleBindGroup = null;
    for (const buf of this.vertexPool.values()) buf.destroy();
    this.vertexPool.clear();
    this.bundleCache.clear();
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

  private blitGpuToPresent(): void {
    const presentCanvas = this.canvas;
    const gpuCanvas = this.gpuCanvas;
    if (!presentCanvas || !gpuCanvas || !this.gpuDrawnThisFrame) return;
    const ctx = presentCanvas.getContext('2d');
    if (!ctx) return;
    // GPU output is already in screen/CSS space (camera applied in shader).
    // Draw in device pixels with identity so we don't double-apply CanvasArea's
    // camera transform that may already be on the 2D context.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(gpuCanvas, 0, 0);
    ctx.restore();
  }

  private writeCameraUniform(frame: CompositorFrame): void {
    const device = this.device;
    const cameraBuffer = this.cameraBuffer;
    if (!device || !cameraBuffer) return;
    const camera = frame.camera;
    const viewport = frame.viewport;
    const origin = computeFloatingOrigin(camera, viewport);
    // Layout: pan(8) zoom(4) viewportW(4) viewportH(4) rotation(4) origin(8)
    const cam = new Float32Array([
      camera.pan.x,
      camera.pan.y,
      camera.zoom,
      viewport.width,
      viewport.height,
      camera.rotation ?? 0,
      origin[0],
      origin[1],
    ]);
    device.queue.writeBuffer(cameraBuffer, 0, cam);
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

    this.writeCameraUniform(frame);

    const textureView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    // Each invocation is an ordered run. Earlier GPU pixels have already been
    // presented to Canvas2D; retaining them here would make a later blit
    // cumulative and duplicate earlier runs.
    let firstPass = true;
    const dpr = window.devicePixelRatio || 1;

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
        pass.executeBundles([bundle]);
        pass.end();
      }
    }

    const camera = frame.camera;
    const origin = computeFloatingOrigin(camera, frame.viewport);

    for (const circleItem of circleItems) {
      const circleVerts = buildVertices([circleItem]);
      if (circleVerts.length === 0) continue;
      const prim = circleItem.primitive;
      if (prim.kind !== 'circle') continue;
      const t = circleItem.transform;
      const [worldCx, worldCy] = applyItemAffine([prim.cx, prim.cy], t);
      const [screenCx, screenCy] = worldToScreenCss(
        worldCx,
        worldCy,
        camera,
        frame.viewport,
        origin,
      );
      const screenR = prim.r * camera.zoom;
      // @builtin(position) is in framebuffer pixels; uniforms must match DPR.
      const circleData = new Float32Array([screenCx * dpr, screenCy * dpr, screenR * dpr, 0]);
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
