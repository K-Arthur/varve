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
 * Lines are tessellated as thin quads; solid geometry arrives as unit-quad
 * local coordinates (see `composeItemAffine`); ovals carry per-vertex radii.
 * Explicit pipeline layouts + vertex buffer ring pool.
 */
import { selectWebGpuAdapter } from '@varve/engine';
import { computeFloatingOrigin, managedColorToNormalized } from '@varve/shared';
import { Canvas2DBackend } from '../canvas2d/backend';
import { resolveGpuSolidPaint } from '../solidPaint';
import { buildStructuralRenderPlan } from '../structuralRenderPlan';
import type { CompositorDiagnostics, CompositorFrame, CompositorImagePolicy } from '../types';
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
const SOLID_VERTEX_FLOATS = 12;
const SOLID_VERTICES_PER_ITEM = 6;
/** Per-oval vertex floats: pos(2) color(4) transform(4+2) oval(4). */
const CIRCLE_VERTEX_FLOATS = 16;
const CIRCLE_VERTICES_PER_ITEM = 6;
const MAX_VERTEX_UPLOAD_BYTES = 4 * 1024 * 1024;
/**
 * Automatic device-loss recovery stays bounded: one attempt per loss, two
 * per backend lifetime, then the backend stays down on Canvas2D with a
 * truthful "reload to retry" status instead of looping against a broken
 * driver or resurrecting a deliberately destroyed device.
 */
const MAX_DEVICE_LOSS_RECOVERY_ATTEMPTS = 2;
const CIRCLE_QUAD_CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

const PREMUL_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

function fillToRgba(fill: RenderItem['fill']): [number, number, number, number] {
  if (fill && typeof fill === 'object' && 'space' in fill) {
    try {
      return managedColorToNormalized(fill);
    } catch {
      return [0, 0, 0, 1];
    }
  }
  if (Array.isArray(fill)) {
    return [fill[0] / 255, fill[1] / 255, fill[2] / 255, fill[3] / 255];
  }
  return [0, 0, 0, 1];
}

/** Testable normalized upload adapter; the GPU target remains a display surface. */
export function normalizedGpuFillColor(fill: RenderItem['fill']): [number, number, number, number] {
  return fillToRgba(fill);
}

/**
 * Final vertex color for an item: the resolved solid paint (legacy singular
 * fill or single visible stack entry) premultiplied by the fill's own
 * opacity and the item opacity, matching replayIr's `itemAlpha * fill.opacity`.
 */
function itemGpuColor(item: RenderItem): [number, number, number, number] {
  const paint = resolveGpuSolidPaint(item);
  const c = fillToRgba(paint ? paint.color : item.fill);
  const fillOpacity = paint ? paint.opacity : 1;
  return [c[0], c[1], c[2], c[3] * fillOpacity * (item.opacity ?? 1)];
}

/**
 * Compose an item affine with a quad-placement affine (I ∘ Q). The quad
 * places the unit square (0..1)² onto authored geometry — a rect at x/y with
 * w/h, or a line's perpendicular-offset parallelogram — and the item affine
 * carries it into world space. Folding lets the vertex shader receive unit
 * local coordinates, which is what the fragment's analytic edge coverage
 * measures against: absolute corners cannot recover the rect bounds
 * per-fragment. Convention matches `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
export function composeItemAffine(
  item: readonly [number, number, number, number, number, number],
  quad: readonly [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = item;
  const [qa, qb, qc, qd, qe, qf] = quad;
  return [
    a * qa + c * qb,
    b * qa + d * qb,
    a * qc + c * qd,
    b * qc + d * qd,
    a * qe + c * qf + e,
    b * qe + d * qf + f,
  ];
}

/** Unit-quad triangulation matching the historical rect corner order. */
const UNIT_QUAD: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 0],
  [0, 1],
  [1, 1],
];

/** Unit-quad triangulation matching the historical line corner order. */
const UNIT_PARALLELOGRAM: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 0],
  [1, 1],
  [0, 1],
];

function pushUnitQuad(
  vertices: GpuVertex[],
  color: [number, number, number, number],
  composed: readonly [number, number, number, number, number, number],
  corners: readonly [number, number][],
): void {
  const transform: [number, number, number, number] = [
    composed[0],
    composed[1],
    composed[2],
    composed[3],
  ];
  const transform2: [number, number] = [composed[4], composed[5]];
  for (const p of corners) vertices.push({ localPos: p, color, transform, transform2 });
}

function buildVertices(items: RenderItem[]): GpuVertex[] {
  const vertices: GpuVertex[] = [];
  for (const item of items) {
    const c = itemGpuColor(item);
    const col: [number, number, number, number] = [c[0], c[1], c[2], c[3]];
    const t = item.transform;
    const prim = item.primitive;
    if (prim.kind === 'rect') {
      pushUnitQuad(
        vertices,
        col,
        composeItemAffine(t, [prim.w, 0, 0, prim.h, prim.x, prim.y]),
        UNIT_QUAD,
      );
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
      // p4 = p2 + p3 - p1 completes the parallelogram the unit square maps
      // onto; it is never read directly (UNIT_PARALLELOGRAM carries (1,1)).
      pushUnitQuad(
        vertices,
        col,
        composeItemAffine(t, [
          p2[0] - p1[0],
          p2[1] - p1[1],
          p3[0] - p1[0],
          p3[1] - p1[1],
          p1[0],
          p1[1],
        ]),
        UNIT_PARALLELOGRAM,
      );
    }
  }
  return vertices;
}

/** Keep the rounded pooled allocation below the device limit and a 4 MiB working cap. */
function maxItemsPerUpload(maxBufferSize: number, bytesPerItem: number): number {
  const capped = Math.min(Math.floor(maxBufferSize), MAX_VERTEX_UPLOAD_BYTES);
  if (!Number.isFinite(capped) || capped < bytesPerItem) return 0;
  const roundedBudget = 2 ** Math.floor(Math.log2(capped));
  return Math.floor(roundedBudget / bytesPerItem);
}

export function maxCircleItemsPerUpload(maxBufferSize: number): number {
  return maxItemsPerUpload(maxBufferSize, CIRCLE_VERTICES_PER_ITEM * CIRCLE_VERTEX_FLOATS * 4);
}

export function maxSolidItemsPerUpload(maxBufferSize: number): number {
  return maxItemsPerUpload(maxBufferSize, SOLID_VERTICES_PER_ITEM * SOLID_VERTEX_FLOATS * 4);
}

/**
 * Per-vertex oval parameters (cx, cy, rx, ry). Circles carry r in both
 * radii so circle and ellipse primitives share one stage and one layout.
 */
function ovalParams(
  prim: Extract<RenderItem['primitive'], { kind: 'circle' | 'ellipse' }>,
): readonly [number, number, number, number] {
  if (prim.kind === 'circle') return [prim.cx, prim.cy, prim.r, prim.r];
  return [prim.cx, prim.cy, prim.rx, prim.ry];
}

function flattenCircleVertices(items: readonly RenderItem[]): Float32Array {
  const data = new Float32Array(items.length * CIRCLE_VERTICES_PER_ITEM * CIRCLE_VERTEX_FLOATS);
  let offset = 0;
  for (const item of items) {
    const prim = item.primitive;
    if (prim.kind !== 'circle' && prim.kind !== 'ellipse') continue;
    const color = itemGpuColor(item);
    const alpha = color[3];
    const transform = item.transform;
    const [cx, cy, rx, ry] = ovalParams(prim);
    for (const [dx, dy] of CIRCLE_QUAD_CORNERS) {
      data[offset++] = cx + dx * rx;
      data[offset++] = cy + dy * ry;
      data[offset++] = color[0];
      data[offset++] = color[1];
      data[offset++] = color[2];
      data[offset++] = alpha;
      data[offset++] = transform[0];
      data[offset++] = transform[1];
      data[offset++] = transform[2];
      data[offset++] = transform[3];
      data[offset++] = transform[4];
      data[offset++] = transform[5];
      data[offset++] = cx;
      data[offset++] = cy;
      data[offset++] = rx;
      data[offset++] = ry;
    }
  }
  return data;
}

function isGpuPrimitive(item: RenderItem): boolean {
  const k = item.primitive.kind;
  return k === 'rect' || k === 'circle' || k === 'ellipse';
}

/** GPU class of a primitive: rects batch separately from ovals. */
function gpuPrimitiveClass(kind: RenderItem['primitive']['kind']): string {
  if (kind === 'circle' || kind === 'ellipse') return 'oval';
  return kind;
}

/**
 * A singular item affine has no visible area: Canvas2D paints nothing, while
 * a degenerate GPU triangle can still cover a pixel or a line. Fail closed.
 */
function hasVisibleAffine(transform: readonly number[]): boolean {
  const [a, b, c, d] = transform;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return false;
  const det = a * d - b * c;
  return Number.isFinite(det) && Math.abs(det) >= 1e-9;
}

/**
 * The current WebGPU pipelines only reproduce a single solid fill on a rect
 * or an oval (circle/ellipse — one stage, per-vertex radii). Keep this
 * predicate deliberately fail-closed: routing a richer item to the GPU would
 * silently drop paint-stack, stroke, effect, filter, or blend semantics. A
 * whole batch must be supported because splitting it into GPU and Canvas2D
 * partitions changes z-order when the two kinds interleave.
 *
 * The fills stack counts as supported when `resolveGpuSolidPaint` collapses
 * it to one visible solid fill with normal blending — the paint shape real
 * solid-fill documents carry — so those documents reach GPU runs instead of
 * every item falling back as unsupported-paint.
 */
export function isGpuBatchSupported(items: readonly RenderItem[]): boolean {
  const primitiveKinds = new Set(items.map((item) => gpuPrimitiveClass(item.primitive.kind)));
  return (
    items.every(
      (item) =>
        isGpuPrimitive(item) &&
        (item.primitive.kind !== 'rect' ||
          (!item.primitive.cornerRadius && !item.primitive.cornerSmoothing)) &&
        hasVisibleAffine(item.transform) &&
        resolveGpuSolidPaint(item) !== null &&
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
 * One-time presentation self-test for the offscreen → present `drawImage`
 * path. Clears the GPU surface to a known premultiplied color, submits,
 * waits for completion, and reads the result back through `drawImage` on a
 * 2D probe canvas — the exact cross-context path every GPU frame uses to
 * reach the present surface. Browser engines have shipped this path broken
 * (WebKit implemented `drawImage` from a WebGPU canvas only in 2026), and a
 * broken blit would otherwise leave holes where GPU runs should appear while
 * diagnostics report successful submission. A failed probe declines WebGPU
 * before any frame draws; `initFailureReason` carries the named fallback.
 *
 * Exported so tests can assert its fail-closed behavior directly; the
 * hardware evidence for the success path is `circle-transform-parity.spec.ts`
 * (which reads real pixels back through the same path).
 */
export const defaultPresentationProbe = async (
  device: GPUDevice,
  gpuCanvas: HTMLCanvasElement,
): Promise<boolean> => {
  try {
    const context = gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) return false;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          // Premultiplied clear with opaque alpha: a straight/premul mix-up
          // or an alphaMode mismatch changes the readback, and the known
          // rgb values detect a channel-order or presentation failure.
          clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    if (typeof device.queue.onSubmittedWorkDone !== 'function') return false;
    await device.queue.onSubmittedWorkDone();
    const probe = document.createElement('canvas');
    probe.width = 8;
    probe.height = 8;
    const ctx = probe.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, 8, 8);
    ctx.drawImage(gpuCanvas, 0, 0, 8, 8);
    const pixel = ctx.getImageData(4, 4, 1, 1).data;
    const expected = [64, 128, 191, 255]; // 0.25/0.5/0.75/1.0 × 255
    let ok = true;
    for (let i = 0; i < expected.length; i += 1) {
      const value = pixel[i] ?? 0;
      if (Math.abs(value - (expected[i] ?? 0)) > 2) ok = false;
    }
    return ok;
  } catch {
    return false;
  }
};

export type GpuPresentationProbe = (
  device: GPUDevice,
  gpuCanvas: HTMLCanvasElement,
) => Promise<boolean>;

export interface WebGPUBackendInitOptions {
  /**
   * Overrides the presentation self-test. jsdom cannot rasterize WebGPU
   * output, so mock-device unit tests inject success; the real probe runs in
   * hardware browser E2E. Never set this in production code.
   */
  presentationProbe?: GpuPresentationProbe;
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

export class WebGPUBackend {
  readonly id = 'webgpu' as const;
  /** Always owns the present (content) canvas via Canvas2D. */
  private present: Canvas2DBackend | null = null;
  private deviceLostHandler: (() => Promise<void>) | null = null;
  private onRecoveredHandler: (() => void) | null = null;
  private recovering = false;
  private recoveryAttempts = 0;
  /** Set by destroy(): an in-flight recovery must not revive the backend. */
  private destroyed = false;
  private gpuReady = false;
  private presentationProbe: GpuPresentationProbe = defaultPresentationProbe;
  private initFailureReason: string | undefined;
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
  private cameraBindGroup: GPUBindGroup | null = null;
  private vertexPool: Map<number, GPUBuffer> = new Map();
  private bundleCache: Map<string, GPURenderBundle> = new Map();
  private currentFrame: CompositorFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lastFrameVertexBytes = 0;
  private pipelineInitMs = 0;
  private gpuDrawnThisFrame = false;
  private gpuItemsDrawnThisFrame = 0;
  private lastFrameGpuItems: number | undefined;
  private fallbackIslandCount = 0;
  private fallbackNodeCount = 0;
  private fallbackReasons: Record<string, number> = {};

  async init(canvas: HTMLCanvasElement, opts?: WebGPUBackendInitOptions): Promise<void> {
    this.canvas = canvas;
    this.presentationProbe = opts?.presentationProbe ?? defaultPresentationProbe;
    // Present surface is ALWAYS Canvas2D on the content canvas — see file header.
    this.present = new Canvas2DBackend();
    await this.present.init(canvas);
    await this.initGpuResources();
  }

  /**
   * Create (or recreate, after device loss) every device-owned GPU resource.
   * The Canvas2D present surface is untouched: on failure the backend stays
   * down with Canvas2D painting, on success the next frame draws through the
   * GPU again. Returns whether the GPU side came up.
   */
  private async initGpuResources(): Promise<boolean> {
    let failureReason = 'WebGPU initialization failed';
    try {
      this.adapterIsFallback = false;
      const gpu = navigator.gpu;
      failureReason = 'WebGPU API unavailable';
      if (!gpu) throw new Error('WebGPU unavailable');
      failureReason = 'WebGPU adapter unavailable';
      const selection = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
      if (selection.kind === 'declined-software') {
        this.adapterIsFallback = true;
        failureReason = 'software WebGPU adapter declined';
        throw new Error('WebGPU adapter is software-emulated; declining in favor of Canvas2D');
      }
      if (selection.kind === 'unavailable') throw new Error('No WebGPU adapter');
      const { adapter } = selection;
      failureReason = 'WebGPU device request failed';
      const device = await adapter.requestDevice();
      this.device = device;

      failureReason = 'WebGPU canvas context unavailable';
      const gpuCanvas = document.createElement('canvas');
      gpuCanvas.width = Math.max(1, this.canvas?.width || 1);
      gpuCanvas.height = Math.max(1, this.canvas?.height || 1);
      const context = gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!context) {
        throw new Error('WebGPU canvas context unavailable');
      }
      failureReason = 'WebGPU pipeline initialization failed';
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

      const circleVertexBufferLayout: GPUVertexBufferLayout = {
        arrayStride: 64,
        attributes: [
          ...vertexBufferLayout.attributes,
          { shaderLocation: 4, offset: 48, format: 'float32x4' },
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

      const solidPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [solidBindGroupLayout],
      });

      const colorTarget: GPUColorTargetState = {
        format: this.format,
        blend: PREMUL_BLEND,
      };

      const solidPipeline = await device.createRenderPipelineAsync({
        layout: solidPipelineLayout,
        vertex: { module: solidModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: solidModule,
          entryPoint: 'fs_main',
          targets: [colorTarget],
        },
        primitive: { topology: 'triangle-list' },
      });

      const circlePipeline = await device.createRenderPipelineAsync({
        layout: solidPipelineLayout,
        vertex: {
          module: circleModule,
          entryPoint: 'vs_main',
          buffers: [circleVertexBufferLayout],
        },
        fragment: {
          module: circleModule,
          entryPoint: 'fs_main',
          targets: [colorTarget],
        },
        primitive: { topology: 'triangle-list' },
      });

      this.pipelineInitMs = performance.now() - pipelineInitStart;

      failureReason = 'WebGPU presentation probe failed';
      const probeOk = await this.presentationProbe(device, gpuCanvas);
      if (!probeOk) throw new Error('WebGPU presentation probe failed');

      const cameraBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const cameraBindGroup = device.createBindGroup({
        layout: solidBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
      });
      this.gpuCanvas = gpuCanvas;
      this.context = context;
      this.solidPipeline = solidPipeline;
      this.circlePipeline = circlePipeline;
      this.cameraBuffer = cameraBuffer;
      this.cameraBindGroup = cameraBindGroup;
      this.gpuReady = true;
      this.initFailureReason = undefined;
      this.deviceLost = false;
      this.watchDeviceLost(device);
      return true;
    } catch {
      this.initFailureReason = failureReason;
      this.gpuReady = false;
      this.teardownGpuOnly();
      return false;
    }
  }

  beginFrame(frame: CompositorFrame, opts?: BeginOpts): void {
    this.currentFrame = frame;
    this.gpuDrawnThisFrame = false;
    this.gpuItemsDrawnThisFrame = 0;
    this.fallbackIslandCount = 0;
    this.fallbackNodeCount = 0;
    this.fallbackReasons = {};
    this.lastFrameVertexBytes = 0;
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

  drawVectorItems(
    items: RenderItem[],
    colorOptions?: import('../types').CompositorColorOptions,
    imagePolicy?: CompositorImagePolicy,
  ): void {
    if (!items.length) return;
    if (
      this.gpuReady &&
      this.device &&
      this.context &&
      this.solidPipeline &&
      this.circlePipeline &&
      this.cameraBuffer &&
      this.cameraBindGroup &&
      this.gpuCanvas
    ) {
      const frame = this.currentFrame;
      if (frame) {
        const maxBufferSize = this.device.limits.maxBufferSize;
        const plan = buildStructuralRenderPlan(items, frame.structure);
        this.fallbackIslandCount += plan.fallbackIslandCount;
        this.fallbackNodeCount += plan.fallbackNodeCount;
        for (const [reason, count] of Object.entries(plan.fallbackReasons)) {
          this.fallbackReasons[reason] = (this.fallbackReasons[reason] ?? 0) + count;
        }
        for (const segment of plan.segments) {
          const primitiveKind = segment.items[0]?.primitive.kind;
          const isOval = primitiveKind === 'circle' || primitiveKind === 'ellipse';
          const withinDeviceLimit = isOval
            ? maxCircleItemsPerUpload(maxBufferSize) > 0
            : primitiveKind === 'rect'
              ? maxSolidItemsPerUpload(maxBufferSize) > 0
              : true;
          let drawFailed = false;
          if (
            segment.kind === 'webgpu-run' &&
            isGpuBatchSupported(segment.items) &&
            withinDeviceLimit &&
            this.gpuReady
          ) {
            const previouslyDrawn = this.gpuDrawnThisFrame;
            try {
              this.drawGpuItems([...segment.items], frame);
              this.gpuDrawnThisFrame = true;
              this.blitGpuToPresent();
              this.gpuItemsDrawnThisFrame += segment.items.length;
              continue;
            } catch {
              // A failed run has not been presented. Keep earlier ordered runs
              // on the 2D surface and replay this run and every later one there.
              this.gpuDrawnThisFrame = previouslyDrawn;
              this.gpuReady = false;
              this.initFailureReason = 'WebGPU draw failed';
              this.teardownGpuOnly();
              drawFailed = true;
            }
          }
          if (segment.kind === 'webgpu-run') {
            this.fallbackIslandCount++;
            this.fallbackNodeCount += segment.items.length;
            const reason =
              drawFailed || !this.gpuReady
                ? 'gpu-draw-failed'
                : withinDeviceLimit
                  ? 'unsupported-primitive'
                  : 'resource-limit';
            this.fallbackReasons[reason] = (this.fallbackReasons[reason] ?? 0) + 1;
          }
          // Keep the complete semantic island on Canvas2D. No backend
          // partition is allowed to reorder the compositor's paint order.
          this.present?.drawVectorItems([...segment.items], colorOptions, imagePolicy);
        }
      }
      return;
    }
    this.present?.drawVectorItems(items, colorOptions, imagePolicy);
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
    this.lastFrameGpuItems = this.gpuItemsDrawnThisFrame;
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
      initFailureReason: this.initFailureReason,
      lastFrameGpuItems: this.lastFrameGpuItems,
      pipelineInitMs: this.pipelineInitMs,
      deviceLost: this.deviceLost,
      fallbackIslandCount: this.fallbackIslandCount,
      fallbackNodeCount: this.fallbackNodeCount,
      fallbackReasons: { ...this.fallbackReasons },
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.teardownGpuOnly();
    this.present?.destroy();
    this.present = null;
    this.canvas = null;
  }

  set onDeviceLost(handler: (() => Promise<void>) | undefined) {
    this.deviceLostHandler = handler ?? null;
  }

  /** Invoked once after an automatic recovery rebuilds the GPU side. */
  set onRecovered(handler: (() => void) | undefined) {
    this.onRecoveredHandler = handler ?? null;
  }

  watchDeviceLost(device: GPUDevice): void {
    const wasCurrentDevice = this.device === device;
    void device.lost.then(async () => {
      // `destroy()` resolves the same promise. A normal backend teardown must
      // not be reported as a runtime loss or invoke the host recovery hook.
      if (wasCurrentDevice && this.device !== device) return;
      this.deviceLost = true;
      // In-place recovery: present canvas was always 2D, so dropping GPU
      // leaves a working Canvas2D path. No remount/reload required.
      this.teardownGpuOnly();
      this.gpuReady = false;
      if (this.deviceLostHandler) await this.deviceLostHandler();
      await this.attemptDeviceLossRecovery();
    });
  }

  /**
   * One bounded attempt to rebuild the GPU side after a runtime loss. The
   * Canvas2D present surface stayed live the whole time, so a failure here
   * just leaves the honest fallback status; a success flips diagnostics back
   * to healthy and the next frame resumes GPU drawing.
   */
  private async attemptDeviceLossRecovery(): Promise<void> {
    if (this.destroyed) return;
    if (this.recovering || this.recoveryAttempts >= MAX_DEVICE_LOSS_RECOVERY_ATTEMPTS) {
      if (this.recoveryAttempts >= MAX_DEVICE_LOSS_RECOVERY_ATTEMPTS) {
        this.initFailureReason = 'WebGPU device was lost repeatedly; reload to retry WebGPU';
      }
      return;
    }
    this.recovering = true;
    this.recoveryAttempts++;
    const recovered = await this.initGpuResources();
    this.recovering = false;
    // destroy() may have raced the rebuild; drop whatever it created.
    if (this.destroyed) {
      this.teardownGpuOnly();
      this.gpuReady = false;
      return;
    }
    if (recovered) {
      this.onRecoveredHandler?.();
    }
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
    this.cameraBindGroup = null;
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
    const cameraBindGroup = this.cameraBindGroup;
    if (
      !device ||
      !context ||
      !solidPipeline ||
      !circlePipeline ||
      !cameraBuffer ||
      !cameraBindGroup
    )
      return;

    const solidItems = items.filter(
      (i) => i.primitive.kind !== 'circle' && i.primitive.kind !== 'ellipse',
    );
    const ovalItems = items.filter(
      (i) => i.primitive.kind === 'circle' || i.primitive.kind === 'ellipse',
    );

    this.writeCameraUniform(frame);

    const textureView = context.getCurrentTexture().createView();
    let encoder = device.createCommandEncoder();
    // Each invocation is an ordered run. Earlier GPU pixels have already been
    // presented to Canvas2D; retaining them here would make a later blit
    // cumulative and duplicate earlier runs.
    let firstPass = true;

    if (solidItems.length > 0) {
      const maxItems = maxSolidItemsPerUpload(device.limits.maxBufferSize);
      if (maxItems === 0) throw new Error('Solid vertex buffer exceeds device limit');
      for (let start = 0; start < solidItems.length; start += maxItems) {
        const end = Math.min(start + maxItems, solidItems.length);
        const solidVerts = buildVertices(solidItems.slice(start, end));
        const data = flattenVertices(solidVerts);
        this.lastFrameVertexBytes += data.byteLength;
        const hash = this.hashVertices(data);
        const vBuf = this.getOrCreateVertexBuffer(device, data.byteLength);
        device.queue.writeBuffer(vBuf, 0, data);
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
        if (end < solidItems.length) {
          // The next chunk may reuse this pooled buffer. Submit before its
          // queued write so the earlier bundle retains its own geometry.
          device.queue.submit([encoder.finish()]);
          encoder = device.createCommandEncoder();
        }
      }
    }

    if (ovalItems.length > 0) {
      const maxItems = maxCircleItemsPerUpload(device.limits.maxBufferSize);
      if (maxItems === 0) throw new Error('Oval vertex buffer exceeds device limit');
      for (let start = 0; start < ovalItems.length; start += maxItems) {
        const end = Math.min(start + maxItems, ovalItems.length);
        // Center and radii travel with each vertex. The bounded chunk avoids
        // millions of temporary JS objects and preserves queue order when the
        // pooled vertex buffer is reused for the next submission.
        const data = flattenCircleVertices(ovalItems.slice(start, end));
        this.lastFrameVertexBytes += data.byteLength;
        const vBuf = this.getOrCreateVertexBuffer(device, data.byteLength);
        device.queue.writeBuffer(vBuf, 0, data);
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
        pass.setBindGroup(0, cameraBindGroup);
        pass.setVertexBuffer(0, vBuf);
        pass.draw((end - start) * CIRCLE_VERTICES_PER_ITEM);
        pass.end();
        if (end < ovalItems.length) {
          device.queue.submit([encoder.finish()]);
          encoder = device.createCommandEncoder();
        }
      }
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
