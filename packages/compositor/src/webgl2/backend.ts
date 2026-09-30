import {
  cachedImageDims,
  computeImagePlacement,
  getImageCache,
  type RenderItem,
  resolveImageResourceHandle,
} from '@varve/engine';
import { computeFloatingOrigin, managedColorToNormalized } from '@varve/shared';
import { Canvas2DBackend } from '../canvas2d/backend';
import { resolveGpuSolidPaint } from '../solidPaint';
import type {
  CompositorBackend,
  CompositorColorOptions,
  CompositorDiagnostics,
  CompositorFrame,
  CompositorImagePolicy,
} from '../types';

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
const INSTANCE_FLOATS = 15;
const INSTANCE_BYTES = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const MAX_INSTANCE_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_TEXTURE_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_TEXTURE_CACHE_ENTRIES = 32;
const MAX_RECOVERY_ATTEMPTS = 2;

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_unit;
layout(location=1) in vec4 a_transform;
layout(location=2) in vec2 a_translation;
layout(location=3) in vec4 a_bounds;
layout(location=4) in vec4 a_color;
layout(location=5) in float a_kind;
uniform vec4 u_camera; // pan x/y, zoom, rotation
uniform vec2 u_viewport;
uniform vec2 u_origin;
uniform float u_dpr;
uniform sampler2D u_image;
out vec2 v_local;
out vec4 v_color;
flat out float v_kind;
void main() {
  vec2 unit = a_unit * 2.0 - 1.0;
  float halfWidth = a_bounds.z * 0.5;
  float halfHeight = a_bounds.w * 0.5;
  float axisX = length(vec2(a_transform.x, a_transform.y));
  float axisY = length(vec2(a_transform.z, a_transform.w));
  float determinant = abs(a_transform.x * a_transform.w - a_transform.y * a_transform.z);
  float pixelsPerWorld = u_dpr * u_camera.z;
  float padX = axisY / max(determinant * halfWidth * pixelsPerWorld, 0.00001);
  float padY = axisX / max(determinant * halfHeight * pixelsPerWorld, 0.00001);
  vec2 expandedUnit = unit + sign(unit) * vec2(padX, padY);
  vec2 local = a_bounds.xy + (expandedUnit * 0.5 + 0.5) * a_bounds.zw;
  vec2 world = vec2(
    a_transform.x * local.x + a_transform.z * local.y + a_translation.x,
    a_transform.y * local.x + a_transform.w * local.y + a_translation.y
  );
  vec2 zoomed = (world - u_origin) * u_camera.z;
  vec2 center = u_viewport * 0.5;
  vec2 delta = zoomed - center;
  float c = cos(u_camera.w);
  float s = sin(u_camera.w);
  vec2 screen = center + u_camera.xy + vec2(delta.x*c - delta.y*s, delta.x*s + delta.y*c);
  vec2 ndc = vec2(screen.x / u_viewport.x * 2.0 - 1.0, 1.0 - screen.y / u_viewport.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_local = expandedUnit;
  v_color = a_color;
  v_kind = a_kind;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
flat in float v_kind;
uniform sampler2D u_image;
out vec4 out_color;
void main() {
  float coverage;
  if (v_kind > 0.5 && v_kind < 1.5) {
    float edge = length(v_local) - 1.0;
    float aa = max(fwidth(edge), 0.00001);
    coverage = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, edge);
  } else {
    float aaX = max(fwidth(v_local.x), 0.00001);
    float aaY = max(fwidth(v_local.y), 0.00001);
    float coverageX = 1.0 - smoothstep(1.0 - aaX * 0.5, 1.0 + aaX * 0.5, abs(v_local.x));
    float coverageY = 1.0 - smoothstep(1.0 - aaY * 0.5, 1.0 + aaY * 0.5, abs(v_local.y));
    coverage = coverageX * coverageY;
  }
  if (v_kind > 1.5) {
    vec4 sample_color = texture(u_image, clamp(v_local * 0.5 + 0.5, 0.0, 1.0));
    float alpha = sample_color.a * v_color.a * coverage;
    out_color = vec4(sample_color.rgb * alpha, alpha);
  } else {
    float alpha = v_color.a * coverage;
    out_color = vec4(v_color.rgb * alpha, alpha);
  }
}`;

interface GpuInstance {
  item: RenderItem;
  bounds: [number, number, number, number];
  kind: number;
  color: [number, number, number, number];
  image?: { src: string; source: TexImageSource; width: number; height: number };
}

function imageFillInstance(
  item: RenderItem,
  bounds: [number, number, number, number],
  frame?: CompositorFrame,
  imagePolicy?: CompositorImagePolicy,
): GpuInstance | null {
  if (
    item.primitive.kind !== 'rect' ||
    !Number.isFinite(item.opacity ?? 1) ||
    (item.opacity ?? 1) < 0 ||
    (item.opacity ?? 1) > 1
  )
    return null;
  const fills = item.fills?.filter((fill) => fill.visible) ?? [];
  if (fills.length !== 1) return null;
  const fill = fills[0]!;
  if (
    fill.type !== 'image' ||
    !fill.src ||
    fill.fit !== 'stretch' ||
    fill.x !== 0 ||
    fill.y !== 0 ||
    fill.scale !== 1 ||
    fill.crop !== undefined ||
    fill.rotation !== undefined ||
    fill.flipH === true ||
    fill.flipV === true ||
    fill.alphaMask !== undefined ||
    fill.frame !== undefined ||
    fill.blendMode !== 'normal' ||
    !Number.isFinite(fill.opacity) ||
    fill.opacity < 0 ||
    fill.opacity > 1
  )
    return null;

  const cache = getImageCache();
  const src = resolveImageResourceHandle(fill.src);
  const sourceWidth = fill.imageWidth ?? 0;
  const sourceHeight = fill.imageHeight ?? 0;
  const transform = item.transform;
  const projectedLongEdge = frame
    ? Math.max(
        bounds[2] * Math.hypot(transform[0], transform[1]) * frame.camera.zoom,
        bounds[3] * Math.hypot(transform[2], transform[3]) * frame.camera.zoom,
      )
    : Math.max(bounds[2], bounds[3]);
  const maxSourceDim =
    imagePolicy?.resolveMaxSourceDim?.({
      projectedLongEdge,
      sourceWidth: sourceWidth || undefined,
      sourceHeight: sourceHeight || undefined,
    }) ?? imagePolicy?.maxSourceDim;
  let cached =
    maxSourceDim &&
    maxSourceDim > 0 &&
    sourceWidth > maxSourceDim &&
    cache.isRepresentationCapable(src)
      ? (cache.getImageAtSize(src, maxSourceDim) ?? cache.getClosestImageAtSize(src, maxSourceDim))
      : cache.getImage(src);
  // Canvas2D replay may continue using an already-resident full image while
  // a bounded proxy is loading. Match that behavior, but keep texture memory
  // bounded separately below.
  if (!cached && maxSourceDim && maxSourceDim > 0) cached = cache.getImage(src);
  if (!cached) return null;
  const dimensions = cachedImageDims(cached);
  if (dimensions.width <= 0 || dimensions.height <= 0) return null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  if (
    !frame ||
    Math.abs(frame.camera.rotation ?? 0) > 0.0001 ||
    Math.abs(frame.camera.zoom * dpr - 1) > 0.0001 ||
    Math.abs(transform[0] - 1) > 0.0001 ||
    Math.abs(transform[1]) > 0.0001 ||
    Math.abs(transform[2]) > 0.0001 ||
    Math.abs(transform[3] - 1) > 0.0001 ||
    Math.abs(dimensions.width - bounds[2]) > 0.0001 ||
    Math.abs(dimensions.height - bounds[3]) > 0.0001
  )
    return null;
  const naturalWidth = sourceWidth || dimensions.width;
  const naturalHeight = sourceHeight || dimensions.height;

  const placement = computeImagePlacement({
    fit: fill.fit,
    sourceWidth: naturalWidth,
    sourceHeight: naturalHeight,
    bounds: { x: bounds[0], y: bounds[1], w: bounds[2], h: bounds[3] },
    x: fill.x,
    y: fill.y,
    scale: fill.scale,
  });
  if (
    !placement ||
    placement.drawRect.x !== bounds[0] ||
    placement.drawRect.y !== bounds[1] ||
    placement.drawRect.w !== bounds[2] ||
    placement.drawRect.h !== bounds[3] ||
    placement.sourceRect.x !== 0 ||
    placement.sourceRect.y !== 0 ||
    placement.sourceRect.w !== naturalWidth ||
    placement.sourceRect.h !== naturalHeight
  )
    return null;

  return {
    item,
    bounds,
    kind: 2,
    color: [1, 1, 1, fill.opacity * (item.opacity ?? 1)],
    image: {
      src,
      source: cached as TexImageSource,
      width: dimensions.width,
      height: dimensions.height,
    },
  };
}

function isDevicePixelAlignedAxisRect(
  item: RenderItem,
  bounds: readonly [number, number, number, number],
  frame?: CompositorFrame,
): boolean {
  if (!frame) return false;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const { camera, viewport } = frame;
  if (
    !Number.isFinite(dpr) ||
    dpr <= 0 ||
    !Number.isFinite(camera.zoom) ||
    camera.zoom <= 0 ||
    !Number.isFinite(camera.pan.x) ||
    !Number.isFinite(camera.pan.y)
  )
    return false;

  const origin = computeFloatingOrigin(camera, viewport);
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const rotation = camera.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const [a, b, c, d, e, f] = item.transform;
  const localCorners = [
    [bounds[0], bounds[1]],
    [bounds[0] + bounds[2], bounds[1]],
    [bounds[0] + bounds[2], bounds[1] + bounds[3]],
    [bounds[0], bounds[1] + bounds[3]],
  ] as const;
  const screenCorners = localCorners.map(([x, y]) => {
    const worldX = a * x + c * y + e;
    const worldY = b * x + d * y + f;
    const dx = (worldX - origin[0]) * camera.zoom - centerX;
    const dy = (worldY - origin[1]) * camera.zoom - centerY;
    return {
      x: (centerX + camera.pan.x + dx * cos - dy * sin) * dpr,
      y: (centerY + camera.pan.y + dx * sin + dy * cos) * dpr,
    };
  });
  const pixelTolerance = 0.0001;
  if (
    screenCorners.some(
      ({ x, y }) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x - Math.round(x)) > pixelTolerance ||
        Math.abs(y - Math.round(y)) > pixelTolerance,
    )
  )
    return false;

  // Device-aligned vertices alone do not make a rotated edge pixel-aligned.
  // Keep diagonal or skewed edges on Canvas2D, whose rasterizer defines the
  // authoritative antialiasing for the document.
  return screenCorners.every((corner, index) => {
    const next = screenCorners[(index + 1) % screenCorners.length]!;
    const dx = next.x - corner.x;
    const dy = next.y - corner.y;
    return Math.abs(dx) <= pixelTolerance || Math.abs(dy) <= pixelTolerance;
  });
}

function isSupported(
  item: RenderItem,
  frame?: CompositorFrame,
  imagePolicy?: CompositorImagePolicy,
): GpuInstance | null {
  const primitive = item.primitive;
  // Ellipse edge coverage still differs visibly from the authoritative
  // Canvas2D rasterizer at fractional/rotated boundaries. Keep it on Canvas2D
  // until the GPU path can meet the exact edge-parity gate.
  if (primitive.kind !== 'rect') return null;
  if (primitive.kind === 'rect' && (primitive.cornerRadius || primitive.cornerSmoothing))
    return null;
  if (
    (item.strokes?.length ?? 0) > 0 ||
    (item.effects?.length ?? 0) > 0 ||
    (item.filters?.length ?? 0) > 0 ||
    (item.blendMode !== undefined && item.blendMode !== 'normal')
  )
    return null;
  const [a, b, c, d] = item.transform;
  const determinant = a * d - b * c;
  const basisArea = Math.hypot(a, b) * Math.hypot(c, d);
  if (
    !item.transform.every(Number.isFinite) ||
    !Number.isFinite(determinant) ||
    Math.abs(determinant) < 1e-9 ||
    !Number.isFinite(basisArea) ||
    basisArea <= 0 ||
    Math.abs(determinant) / basisArea < 1e-4
  )
    return null;
  const bounds: [number, number, number, number] = [
    primitive.x,
    primitive.y,
    primitive.w,
    primitive.h,
  ];
  if (!bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) return null;
  if (!isDevicePixelAlignedAxisRect(item, bounds, frame)) return null;
  const imageInstance = imageFillInstance(item, bounds, frame, imagePolicy);
  if (imageInstance) return imageInstance;
  const paint = resolveGpuSolidPaint(item);
  if (
    paint?.color.space !== 'rgb' ||
    !Number.isFinite(paint.opacity) ||
    paint.opacity < 0 ||
    paint.opacity > 1 ||
    !Number.isFinite(item.opacity ?? 1) ||
    (item.opacity ?? 1) < 0 ||
    (item.opacity ?? 1) > 1
  )
    return null;
  let rgba: [number, number, number, number];
  try {
    rgba = managedColorToNormalized(paint.color);
  } catch {
    return null;
  }
  if (!rgba.every(Number.isFinite)) return null;
  rgba[3] *= paint.opacity * (item.opacity ?? 1);
  return { item, bounds, kind: 0, color: rgba };
}

/** False means the compositor must preserve the item on Canvas2D. */
export function isWebGL2ItemEligible(item: RenderItem, frame?: CompositorFrame): boolean {
  return isSupported(item, frame) !== null;
}

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error('WebGL2 shader allocation failed');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(result) ?? 'WebGL2 shader compilation failed';
    gl.deleteShader(result);
    throw new Error(detail);
  }
  return result;
}

export class WebGL2Backend implements CompositorBackend {
  readonly id = 'webgl2' as const;
  private present: Canvas2DBackend | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private unitBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private textures = new Map<
    string,
    { texture: WebGLTexture; source: TexImageSource; bytes: number }
  >();
  private textureCacheBytes = 0;
  private frame: CompositorFrame | null = null;
  private gpuItems = 0;
  private fallbackCanvasItems = 0;
  private textureUploads = 0;
  private submitCpuMs = 0;
  private blitCpuMs = 0;
  private active = false;
  private destroyed = false;
  private lost = false;
  private recoveryAttempts = 0;
  private failureReason: string | undefined;
  onDeviceLost?: () => Promise<void>;
  onRecovered?: () => void;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const present = new Canvas2DBackend();
    await present.init(canvas);
    this.present = present;
    this.visibleCanvas = canvas;
    const gpuCanvas = document.createElement('canvas');
    const gl = gpuCanvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      this.failureReason = 'WebGL2 context unavailable';
      return;
    }
    this.canvas = gpuCanvas;
    this.gl = gl;
    gpuCanvas.addEventListener('webglcontextlost', this.handleContextLost);
    gpuCanvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    try {
      this.createResources();
      this.active = this.presentationProbe();
      if (!this.active) throw new Error('WebGL2 presentation probe failed');
      this.failureReason = undefined;
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : 'WebGL2 initialization failed';
      this.releaseGpuResources();
    }
  }

  beginFrame(frame: CompositorFrame, opts?: { applyCamera?: boolean; clear?: boolean }): void {
    this.frame = frame;
    this.gpuItems = 0;
    this.fallbackCanvasItems = 0;
    this.textureUploads = 0;
    this.submitCpuMs = 0;
    this.blitCpuMs = 0;
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    if (canvas) {
      const width = Math.max(1, Math.floor(frame.viewport.width * dpr));
      const height = Math.max(1, Math.floor(frame.viewport.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    this.present?.beginFrame(frame, opts);
  }

  drawVectorItems(
    items: RenderItem[],
    colorOptions?: CompositorColorOptions,
    imagePolicy?: CompositorImagePolicy,
  ): void {
    if (!items.length) return;
    const frame = this.frame;
    const gl = this.gl;
    if (!this.active || !frame || !gl || !this.program || !this.vao || !this.instanceBuffer) {
      this.present?.drawVectorItems(items, colorOptions, imagePolicy);
      this.fallbackCanvasItems += items.length;
      return;
    }
    let cursor = 0;
    while (cursor < items.length) {
      const first = isSupported(items[cursor]!, frame, imagePolicy);
      if (!first) {
        this.present?.drawVectorItems([items[cursor]!], colorOptions, imagePolicy);
        this.fallbackCanvasItems++;
        cursor++;
        continue;
      }
      const run: GpuInstance[] = [first];
      let end = cursor + 1;
      while (end < items.length) {
        const instance = isSupported(items[end]!, frame, imagePolicy);
        if (
          !instance ||
          Boolean(instance.image) !== Boolean(first.image) ||
          (first.image !== undefined &&
            (instance.image?.src !== first.image.src ||
              instance.image.source !== first.image.source))
        )
          break;
        run.push(instance);
        end++;
      }
      const maxPerDraw = Math.max(1, Math.floor(MAX_INSTANCE_UPLOAD_BYTES / INSTANCE_BYTES));
      for (let offset = 0; offset < run.length; offset += maxPerDraw) {
        const chunk = run.slice(offset, offset + maxPerDraw);
        try {
          const submitStart = performance.now();
          const submitted = this.drawRun(chunk, frame);
          this.submitCpuMs += performance.now() - submitStart;
          if (!submitted) {
            this.present?.drawVectorItems(
              chunk.map((instance) => instance.item),
              colorOptions,
              imagePolicy,
            );
            this.fallbackCanvasItems += chunk.length;
            continue;
          }
          const blitStart = performance.now();
          this.blit();
          this.blitCpuMs += performance.now() - blitStart;
          this.gpuItems += chunk.length;
        } catch (error) {
          this.active = false;
          this.failureReason = error instanceof Error ? error.message : 'WebGL2 draw failed';
          this.releaseGpuResources();
          const fallback = items.slice(cursor + offset);
          this.present?.drawVectorItems(fallback, colorOptions, imagePolicy);
          this.fallbackCanvasItems += fallback.length;
          return;
        }
      }
      cursor = end;
    }
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
  }

  destroy(): void {
    this.destroyed = true;
    this.canvas?.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.releaseGpuResources();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
    this.canvas = null;
    this.present?.destroy();
    this.present = null;
  }

  getDiagnostics(): CompositorDiagnostics {
    return {
      backendId: 'webgl2',
      gpuActive: this.active,
      vertexPoolEntries: 0,
      bundleCacheEntries: 0,
      lastFrameVertexBytes: this.gpuItems * INSTANCE_BYTES,
      adapterIsFallback: false,
      lastFrameGpuItems: this.gpuItems,
      lastFrameFallbackCanvasItems: this.fallbackCanvasItems,
      lastFrameTextureUploads: this.textureUploads,
      lastFrameSubmitCpuMs: this.submitCpuMs,
      lastFrameBlitCpuMs: this.blitCpuMs,
      gpuTextureBytes: this.textureCacheBytes,
      ...(this.failureReason ? { initFailureReason: this.failureReason } : {}),
      ...(this.lost ? { deviceLost: true } : {}),
    };
  }

  private createResources(): void {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 context unavailable');
    const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL2 program allocation failed');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const detail = gl.getProgramInfoLog(program) ?? 'WebGL2 program link failed';
      gl.deleteProgram(program);
      throw new Error(detail);
    }
    const vao = gl.createVertexArray();
    const unitBuffer = gl.createBuffer();
    const instanceBuffer = gl.createBuffer();
    if (!vao || !unitBuffer || !instanceBuffer) throw new Error('WebGL2 buffer allocation failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, unitBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    const attributes: Array<[number, number, number]> = [
      [1, 4, 0],
      [2, 2, 4],
      [3, 4, 6],
      [4, 4, 10],
      [5, 1, 14],
    ];
    for (const [location, size, offset] of attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, INSTANCE_BYTES, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    this.program = program;
    this.vao = vao;
    this.unitBuffer = unitBuffer;
    this.instanceBuffer = instanceBuffer;
  }

  private drawRun(items: GpuInstance[], frame: CompositorFrame): boolean {
    const gl = this.gl;
    const program = this.program;
    const vao = this.vao;
    const buffer = this.instanceBuffer;
    const canvas = this.canvas;
    if (!gl || !program || !vao || !buffer || !canvas)
      throw new Error('WebGL2 resources unavailable');
    const image = items[0]?.image;
    const texture = image ? this.getOrCreateTexture(image) : null;
    if (image && !texture) return false;
    const origin = computeFloatingOrigin(frame.camera, frame.viewport);
    const instances = new Float32Array(items.length * INSTANCE_FLOATS);
    for (let i = 0; i < items.length; i++) {
      const instance = items[i]!;
      const offset = i * INSTANCE_FLOATS;
      const transform = instance.item.transform;
      instances.set([transform[0], transform[1], transform[2], transform[3]], offset);
      instances.set([transform[4], transform[5]], offset + 4);
      instances.set(instance.bounds, offset + 6);
      instances.set(instance.color, offset + 10);
      instances[offset + 14] = instance.kind;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform4f(
      gl.getUniformLocation(program, 'u_camera'),
      frame.camera.pan.x,
      frame.camera.pan.y,
      frame.camera.zoom,
      frame.camera.rotation ?? 0,
    );
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_viewport'),
      frame.viewport.width,
      frame.viewport.height,
    );
    gl.uniform2f(gl.getUniformLocation(program, 'u_origin'), origin[0], origin[1]);
    gl.uniform1f(gl.getUniformLocation(program, 'u_dpr'), window.devicePixelRatio || 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, items.length);
    gl.flush();
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL2 draw failed');
    return true;
  }

  private getOrCreateTexture(image: NonNullable<GpuInstance['image']>): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const key = `${image.src}\u0000${image.width}x${image.height}`;
    const existing = this.textures.get(key);
    if (existing?.source === image.source) {
      this.textures.delete(key);
      this.textures.set(key, existing);
      return existing.texture;
    }
    if (existing) {
      gl.deleteTexture(existing.texture);
      this.textureCacheBytes -= existing.bytes;
      this.textures.delete(key);
    }

    const bytes = image.width * image.height * 4;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > MAX_TEXTURE_CACHE_BYTES ||
      image.width > maxTextureSize ||
      image.height > maxTextureSize
    )
      return null;
    while (
      this.textures.size >= MAX_TEXTURE_CACHE_ENTRIES ||
      this.textureCacheBytes + bytes > MAX_TEXTURE_CACHE_BYTES
    ) {
      const oldest = this.textures.entries().next().value as
        | [string, { texture: WebGLTexture; source: TexImageSource; bytes: number }]
        | undefined;
      if (!oldest) return null;
      gl.deleteTexture(oldest[1].texture);
      this.textureCacheBytes -= oldest[1].bytes;
      this.textures.delete(oldest[0]);
    }

    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // The vertex UV origin is top-left, matching Canvas2D. Keeping WebGL's
    // first source row at texture y=0 preserves that orientation, including
    // ImageBitmap uploads (for which WebGL ignores UNPACK_FLIP_Y_WEBGL).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image.source);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      return null;
    }
    this.textures.set(key, { texture, source: image.source, bytes });
    this.textureCacheBytes += bytes;
    this.textureUploads++;
    return texture;
  }

  private blit(): void {
    const canvas = this.canvas;
    if (!canvas || !this.present) return;
    // Reuse the present Canvas2D surface through its visible target context.
    const target = this.presentCanvasContext;
    if (!target) return;
    const targetCanvas = this.visibleCanvas;
    if (!targetCanvas) return;
    // The visible canvas backing store is sized by the render pipeline, which
    // scales it by the interactive preview factor (`displayDpr * previewScale`)
    // while a drag, pinch, or wheel burst is open. A 1:1 device-pixel copy would
    // therefore land scale/offset-wrong for every GPU-eligible item at exactly
    // the moment the preview exists, while the Canvas2D items around it stay
    // correct. The GPU surface is a complete frame of the same viewport, so
    // stretching it to the target is exact.
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(canvas, 0, 0, targetCanvas.width, targetCanvas.height);
    target.restore();
  }

  private get presentCanvasContext(): CanvasRenderingContext2D | null {
    return this.visibleCanvas?.getContext('2d') ?? null;
  }

  private visibleCanvas: HTMLCanvasElement | null = null;

  private presentationProbe(): boolean {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas || !this.visibleCanvas || !this.program || !this.vao || !this.instanceBuffer)
      return false;
    const frame: CompositorFrame = {
      items: [],
      camera: { zoom: 1, pan: { x: 0, y: 0 } },
      viewport: { width: 8, height: 8 },
      docVersion: 0,
    };
    canvas.width = 8;
    canvas.height = 8;
    const sample: GpuInstance = {
      item: {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 0, y: 0, w: 8, h: 8 },
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      },
      bounds: [0, 0, 8, 8],
      kind: 0,
      color: [0.25, 0.5, 0.75, 1],
    };
    try {
      this.drawRun([sample], frame);
      const probe = document.createElement('canvas');
      probe.width = 8;
      probe.height = 8;
      const present = probe.getContext('2d');
      if (!present) return false;
      present.drawImage(canvas, 0, 0);
      const rgba = present.getImageData(4, 4, 1, 1).data;
      return (
        Math.abs(rgba[0]! - 64) <= 2 &&
        Math.abs(rgba[1]! - 128) <= 2 &&
        Math.abs(rgba[2]! - 191) <= 2 &&
        rgba[3] === 255
      );
    } catch {
      return false;
    }
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed) return;
    this.active = false;
    this.lost = true;
    this.failureReason = 'WebGL2 context lost';
    this.releaseGpuResources();
    void this.onDeviceLost?.();
  };

  private handleContextRestored = (): void => {
    if (this.destroyed || this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) return;
    this.recoveryAttempts++;
    try {
      this.createResources();
      this.active = this.presentationProbe();
      this.failureReason = this.active ? undefined : 'WebGL2 recovery probe failed';
      if (this.active) {
        this.lost = false;
        this.onRecovered?.();
      }
    } catch {
      this.active = false;
      this.failureReason = 'WebGL2 recovery failed';
      this.releaseGpuResources();
    }
  };

  private releaseGpuResources(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.unitBuffer) gl.deleteBuffer(this.unitBuffer);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    for (const { texture } of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    this.textureCacheBytes = 0;
    this.program = null;
    this.vao = null;
    this.unitBuffer = null;
    this.instanceBuffer = null;
  }
}
