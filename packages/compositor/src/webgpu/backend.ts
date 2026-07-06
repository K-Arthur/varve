/**
 * WebGPU compositor backend — solid fills for rect/circle/line with Canvas2D fallback.
 */
import type { RenderItem } from '@strata/engine';
import { Canvas2DBackend } from '../canvas2d/backend';
import type { CompositorFrame } from '../types';
import { CIRCLE_VERTEX_WGSL, SOLID_FRAGMENT_WGSL } from './shaders';

interface GpuNavigator extends Navigator {
  gpu?: GPU;
}

type BeginOpts = { applyCamera?: boolean; clear?: boolean };

interface GpuVertex {
  localPos: [number, number];
  color: [number, number, number, number];
  transform: [number, number, number, number];
  transform2: [number, number];
}

function fillToRgba(fill: RenderItem['fill']): [number, number, number, number] {
  if (fill && typeof fill === 'object' && 'space' in fill && fill.space === 'rgb') {
    return [fill.r / 255, fill.g / 255, fill.b / 255, fill.a / 255];
  }
  if (Array.isArray(fill)) {
    return [fill[0] / 255, fill[1] / 255, fill[2] / 255, fill[3] / 255];
  }
  return [0, 0, 0, 1];
}

function isGpuPrimitive(item: RenderItem): boolean {
  const k = item.primitive.kind;
  return k === 'rect' || k === 'circle' || k === 'line';
}

function buildVertices(
  items: RenderItem[],
  viewport: { width: number; height: number },
): {
  vertices: GpuVertex[];
  circleMeta: { center: [number, number]; radius: number } | null;
} {
  const vertices: GpuVertex[] = [];
  let circleMeta: { center: [number, number]; radius: number } | null = null;
  const color = (item: RenderItem) => {
    const c = fillToRgba(item.fill);
    return [c[0], c[1], c[2], c[3] * (item.opacity ?? 1)] as [number, number, number, number];
  };
  const xf = (item: RenderItem) => {
    const t = item.transform;
    return {
      transform: [t[0], t[1], t[2], t[3]] as [number, number, number, number],
      transform2: [t[4], t[5]] as [number, number],
    };
  };

  for (const item of items) {
    const col = color(item);
    const { transform, transform2 } = xf(item);
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
        vertices.push({
          localPos: [cx, cy],
          color: col,
          transform,
          transform2,
        });
        vertices.push({
          localPos: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
          color: col,
          transform,
          transform2,
        });
        vertices.push({
          localPos: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)],
          color: col,
          transform,
          transform2,
        });
      }
      const wx = transform[0] * cx + transform[2] * cy + transform2[0];
      const wy = transform[1] * cx + transform[3] * cy + transform2[1];
      circleMeta = { center: [wx, wy], radius: r };
      void viewport;
    } else if (prim.kind === 'line') {
      vertices.push({
        localPos: [prim.from[0], prim.from[1]],
        color: col,
        transform,
        transform2,
      });
      vertices.push({
        localPos: [prim.to[0], prim.to[1]],
        color: col,
        transform,
        transform2,
      });
    }
  }
  return { vertices, circleMeta };
}

export class WebGPUBackend {
  readonly id = 'webgpu' as const;
  private fallback: Canvas2DBackend | null = null;
  private deviceLostHandler: (() => Promise<void>) | null = null;
  private gpuReady = false;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'rgba8unorm';
  private pipeline: GPURenderPipeline | null = null;
  private cameraBuffer: GPUBuffer | null = null;
  private currentFrame: CompositorFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.fallback = new Canvas2DBackend();
    await this.fallback.init(canvas);
    try {
      const gpu = (navigator as GpuNavigator).gpu;
      if (!gpu) return;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return;
      const device = await adapter.requestDevice();
      const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!context) {
        device.destroy();
        return;
      }
      this.format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format: this.format, alphaMode: 'premultiplied' });
      const shaderModule = device.createShaderModule({
        code: `${CIRCLE_VERTEX_WGSL}\n${SOLID_FRAGMENT_WGSL}`,
      });
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main',
          buffers: [
            {
              arrayStride: 48,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' },
                { shaderLocation: 1, offset: 8, format: 'float32x4' },
                { shaderLocation: 2, offset: 24, format: 'float32x4' },
                { shaderLocation: 3, offset: 40, format: 'float32x2' },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });
      const cameraBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device = device;
      this.context = context;
      this.pipeline = pipeline;
      this.cameraBuffer = cameraBuffer;
      this.gpuReady = true;
      this.watchDeviceLost(device);
    } catch {
      this.gpuReady = false;
    }
  }

  beginFrame(frame: CompositorFrame, opts?: BeginOpts): void {
    this.currentFrame = frame;
    if (!this.gpuReady) {
      this.fallback?.beginFrame(frame, opts);
      return;
    }
    if (opts?.clear !== false && this.canvas) {
      const { viewport } = frame;
      const dpr = window.devicePixelRatio || 1;
      if (this.canvas.width !== viewport.width * dpr) {
        this.canvas.width = viewport.width * dpr;
        this.canvas.height = viewport.height * dpr;
      }
    }
  }

  drawVectorItems(items: RenderItem[]): void {
    if (!items.length) return;
    const gpuItems = items.filter(isGpuPrimitive);
    const fallbackItems = items.filter((i) => !isGpuPrimitive(i));
    if (this.gpuReady && this.device && this.context && this.pipeline && this.cameraBuffer) {
      const frame = this.currentFrame;
      if (frame && gpuItems.length > 0) {
        this.drawGpuItems(gpuItems, frame);
      }
    } else {
      this.fallback?.drawVectorItems(items);
      return;
    }
    if (fallbackItems.length > 0) {
      this.fallback?.drawVectorItems(fallbackItems);
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
    this.currentFrame = null;
    this.fallback?.endFrame();
  }

  destroy(): void {
    this.device?.destroy();
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.cameraBuffer = null;
    this.gpuReady = false;
    this.fallback?.destroy();
    this.fallback = null;
    this.canvas = null;
  }

  set onDeviceLost(handler: (() => Promise<void>) | undefined) {
    this.deviceLostHandler = handler ?? null;
  }

  watchDeviceLost(device: GPUDevice): void {
    void device.lost.then(async () => {
      this.gpuReady = false;
      this.device = null;
      if (this.deviceLostHandler) await this.deviceLostHandler();
    });
  }

  private drawGpuItems(items: RenderItem[], frame: CompositorFrame): void {
    const device = this.device;
    const context = this.context;
    const pipeline = this.pipeline;
    const cameraBuffer = this.cameraBuffer;
    if (!device || !context || !pipeline || !cameraBuffer) return;

    const { vertices } = buildVertices(items, frame.viewport);
    if (vertices.length === 0) return;

    const data = new Float32Array(vertices.length * 12);
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i]!;
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

    const vertexBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, data);

    const cam = new Float32Array([
      frame.camera.pan.x,
      frame.camera.pan.y,
      frame.camera.zoom,
      frame.viewport.width,
      frame.viewport.height,
    ]);
    device.queue.writeBuffer(cameraBuffer, 0, cam);

    const textureView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
      }),
    );
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertices.length);
    pass.end();
    device.queue.submit([encoder.finish()]);
    vertexBuffer.destroy();
  }
}
