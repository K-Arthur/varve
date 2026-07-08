/**
 * WebGPU compositor backend — solid fills for rect/circle/line with Canvas2D fallback.
 * Lines are tessellated as thin quads; circles get a dedicated discard shader.
 */
import type { RenderItem } from '@strata/engine';
import { Canvas2DBackend } from '../canvas2d/backend';
import type { CompositorFrame } from '../types';
import { CIRCLE_FRAGMENT_WGSL, CIRCLE_VERTEX_WGSL, SOLID_FRAGMENT_WGSL, SOLID_VERTEX_WGSL } from './shaders';

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

function isGpuPrimitive(item: RenderItem): boolean {
  const k = item.primitive.kind;
  return k === 'rect' || k === 'circle' || k === 'line';
}

function buildVertices(
  items: RenderItem[],
): GpuVertex[] {
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
          { localPos: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], color: col, transform, transform2 },
          { localPos: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], color: col, transform, transform2 },
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

export class WebGPUBackend {
  readonly id = 'webgpu' as const;
  private fallback: Canvas2DBackend | null = null;
  private deviceLostHandler: (() => Promise<void>) | null = null;
  private gpuReady = false;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'rgba8unorm';
  private solidPipeline: GPURenderPipeline | null = null;
  private circlePipeline: GPURenderPipeline | null = null;
  private cameraBuffer: GPUBuffer | null = null;
  private circleUniformBuffer: GPUBuffer | null = null;
  private cameraBindGroup: GPUBindGroup | null = null;
  private circleBindGroup: GPUBindGroup | null = null;
  private currentFrame: CompositorFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.fallback = new Canvas2DBackend();
    await this.fallback.init(canvas);
    try {
      const gpu = navigator.gpu;
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

      const solidPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: solidModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: solidModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      const circlePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: circleModule, entryPoint: 'vs_main', buffers: [vertexBufferLayout] },
        fragment: {
          module: circleModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      const cameraBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const circleUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // Create reusable bind groups
      const cameraBindGroup = device.createBindGroup({
        layout: solidPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
      });
      const circleBindGroup = device.createBindGroup({
        layout: circlePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: cameraBuffer } },
          { binding: 1, resource: { buffer: circleUniformBuffer } },
        ],
      });

      this.device = device;
      this.context = context;
      this.solidPipeline = solidPipeline;
      this.circlePipeline = circlePipeline;
      this.cameraBuffer = cameraBuffer;
      this.circleUniformBuffer = circleUniformBuffer;
      this.cameraBindGroup = cameraBindGroup;
      this.circleBindGroup = circleBindGroup;
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
    if (
      this.gpuReady && this.device && this.context &&
      this.solidPipeline && this.circlePipeline &&
      this.cameraBuffer && this.circleUniformBuffer &&
      this.cameraBindGroup && this.circleBindGroup
    ) {
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
    this.solidPipeline = null;
    this.circlePipeline = null;
    this.cameraBuffer = null;
    this.circleUniformBuffer = null;
    this.cameraBindGroup = null;
    this.circleBindGroup = null;
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
    const solidPipeline = this.solidPipeline;
    const circlePipeline = this.circlePipeline;
    const cameraBuffer = this.cameraBuffer;
    const circleUniformBuffer = this.circleUniformBuffer;
    const cameraBindGroup = this.cameraBindGroup;
    const circleBindGroup = this.circleBindGroup;
    if (!device || !context || !solidPipeline || !circlePipeline ||
        !cameraBuffer || !circleUniformBuffer || !cameraBindGroup || !circleBindGroup) return;

    const solidItems = items.filter((i) => i.primitive.kind !== 'circle');
    const circleItems = items.filter((i) => i.primitive.kind === 'circle');

    const camera = frame.camera;
    const viewport = frame.viewport;
    const cam = new Float32Array([
      camera.pan.x, camera.pan.y, camera.zoom, viewport.width, viewport.height,
    ]);
    device.queue.writeBuffer(cameraBuffer, 0, cam);

    const textureView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();

    // Write circle uniforms for each circle item, then dispatch
    if (circleItems.length > 0 && circlePipeline && circleUniformBuffer && circleBindGroup) {
      const circleVerts = buildVertices(circleItems);
      if (circleVerts.length > 0) {
        // Compute screen-space center + radius for the first circle item
        const prim = circleItems[0].primitive;
        if (prim.kind === 'circle') {
          const t = circleItems[0].transform;
          const screenCx = (t[0] * prim.cx + t[2] * prim.cy + t[4]) * camera.zoom + camera.pan.x;
          const screenCy = (t[1] * prim.cx + t[3] * prim.cy + t[5]) * camera.zoom + camera.pan.y;
          const screenR = prim.r * camera.zoom;
          device.queue.writeBuffer(circleUniformBuffer, 0, new Float32Array([screenCx, screenCy, screenR, 0]));
        }
        const data = flattenVertices(circleVerts);
        const vBuf = this.createAndUploadVertexBuffer(device, data);
        this.drawWithPipeline(encoder, textureView, circlePipeline, circleBindGroup, vBuf, circleVerts.length);
        vBuf.destroy();
      }
    }

    if (solidItems.length > 0 && solidPipeline && cameraBindGroup) {
      const solidVerts = buildVertices(solidItems);
      if (solidVerts.length > 0) {
        const data = flattenVertices(solidVerts);
        const vBuf = this.createAndUploadVertexBuffer(device, data);
        this.drawWithPipeline(encoder, textureView, solidPipeline, cameraBindGroup, vBuf, solidVerts.length);
        vBuf.destroy();
      }
    }

    device.queue.submit([encoder.finish()]);
  }

  private createAndUploadVertexBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
    const buf = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  private drawWithPipeline(
    encoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertexCount);
    pass.end();
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
