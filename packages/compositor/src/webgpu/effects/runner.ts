/// <reference types="@webgpu/types" />
/**
 * WebGPU compute runner for the live-effects family.
 *
 * Executes per-effect WGSL compute kernels over RGBA buffers: upload →
 * dispatch (one or more passes) → readback. Kernel conventions (shared by
 * every effect module in `./kernels/`):
 *
 * - Params: `@group(0) @binding(0) var<storage, read> p: array<f32, 128>` —
 *   flat f32 array, packing order defined per kernel (see the `pack`
 *   helpers below). Booleans are 1/0 f32.
 * - Integer params: `@group(0) @binding(1) var<storage, read> ip: array<u32, 16>`
 *   — exact seeds and other bit-sensitive values. The f32 params retain the
 *   readable value for diagnostics, but shaders use `ip` when exact bits matter.
 * - Palette: `@group(1) @binding(0) var<storage, read> pal: array<f32, 384>`
 *   — up to 128 RGB triplets, each channel 0..1. Only kernels that take a
 *   palette declare it.
 * - Textures: `@group(2)`. Binding 0 = the pass's write target
 *   (`texture_storage_2d<rgba8unorm, write>`); bindings 1+ = sampled
 *   textures (`texture_2d<f32>`); the last binding is the sampler. Sampled
 *   textures are created with STORAGE_BINDING | TEXTURE_BINDING so a texture
 *   written by one pass can be sampled by the next.
 * - Coordinates: `@builtin(global_invocation_id) gid`; UVs are
 *   `(f32(gid.xy) + 0.5) / vec2f(w, h)`.
 *
 * Multi-pass kernels (bloom) declare several passes; intermediate textures
 * are allocated from a bounded pool keyed by name + size. A pass may consume
 * a producer at a different resolution; the planner below carries the
 * producer dimensions into the view binding instead of guessing from the
 * consumer output size.
 *
 * Runtime diagnostics are treated as part of correctness. WGSL read-only
 * storage is valid and is used for all immutable parameter/palette buffers.
 * Missing entry points, layout mismatches, and invalid copies are
 * captured through compilation information and validation error scopes rather
 * than being described as silent browser workarounds.
 */

import type { CoordSpace, EffectQuality } from '@varve/engine';
import { selectWebGpuAdapter } from '@varve/engine/gpuAdapter';

export interface EffectPass {
  /** WGSL entry point (the kernel module may hold several passes). */
  entry: string;
  /** Packed f32 params (kernel-specific layout, <= 128 values). */
  params: Float32Array;
  /** Exact integer params for seeds and hash inputs (<= 16 values). */
  integerParams?: Uint32Array;
  /** Optional palette triplets (0..1); absent = no palette binding. */
  palette?: Float32Array;
  /** Texture bindings: index 0 = write target; 1+ = sampled textures. */
  textures: string[];
  /** Sampler for sampled textures: 'linear' | 'nearest'. */
  sampler: 'linear' | 'nearest';
  /** Workgroup size for the dispatch (2D; `z` must be 1). */
  workgroup: [number, number, number];
  /** Texture sizes for the write target; default = full surface. */
  size?: { width: number; height: number };
}

export interface PlannedEffectPass {
  pass: EffectPass;
  width: number;
  height: number;
  inputs: Array<{ name: string; width: number; height: number }>;
}

export interface GpuKernelSpec {
  /** Kernel id (`'bloom'`, `'crt'`, ...). */
  id: string;
  /** WGSL module source (may contain several entry points). */
  wgsl: string;
  /**
   * Build the dispatch passes for a request. May throw to signal that the
   * request is unsupported on GPU (e.g. sequential error diffusion) — the
   * provider then falls back to the CPU provider.
   */
  buildPasses: (
    request: EffectDispatchRequest,
    surface: { width: number; height: number },
  ) => EffectPass[];
}

export interface EffectDispatchRequest {
  effect:
    | 'dither'
    | 'paletteSnap'
    | 'bloom'
    | 'rgbSplit'
    | 'crt'
    | 'vhs'
    | 'lightShafts'
    | 'lensFlare'
    | 'lightLeak'
    | 'caustics';
  width: number;
  height: number;
  quality: EffectQuality;
  coordSpace?: CoordSpace;
  params: Record<string, unknown>;
}

const PARAM_COUNT = 128;
const MAX_PALETTE = 128;
const INTEGER_PARAM_COUNT = 16;

function assertPositiveDimensions(width: number, height: number, label: string): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`${label} dimensions must be positive integers (${width}x${height})`);
  }
}

/**
 * Resolve pass output and sampled-input dimensions before any GPU allocation.
 * A texture name becomes available only after its producer pass completes, so
 * accidental forward references and read/write feedback are rejected early.
 */
export function planEffectPasses(
  passes: readonly EffectPass[],
  surface: { width: number; height: number },
): PlannedEffectPass[] {
  assertPositiveDimensions(surface.width, surface.height, 'Surface');
  if (passes.length === 0) throw new Error('GPU effect produced no passes');

  const produced = new Map<string, { width: number; height: number }>([
    ['src', { width: surface.width, height: surface.height }],
  ]);
  const planned: PlannedEffectPass[] = [];

  for (const [index, pass] of passes.entries()) {
    const output = pass.textures[0];
    if (!output) throw new Error(`GPU pass ${index} has no write target`);
    if (output === 'src') throw new Error(`GPU pass ${index} cannot overwrite the source texture`);
    const width = pass.size?.width ?? surface.width;
    const height = pass.size?.height ?? surface.height;
    assertPositiveDimensions(width, height, `GPU pass ${index}`);
    if (
      !Array.isArray(pass.workgroup) ||
      pass.workgroup.length !== 3 ||
      pass.workgroup.some((value) => !Number.isInteger(value) || value <= 0)
    ) {
      throw new Error(`GPU pass ${index} has an invalid workgroup size`);
    }
    // Passes write a single 2D storage texture, so the dispatch grid is
    // (ceil(w/wgX), ceil(h/wgY), 1). A z workgroup size other than 1 would
    // either re-run identical invocations or imply a volume this runner
    // cannot bind; reject it instead of silently dispatching a different
    // grid than the shader's `@workgroup_size` declares.
    if (pass.workgroup[2] !== 1) {
      throw new Error(
        `GPU pass ${index} must use a 2D workgroup (z=1); got z=${pass.workgroup[2]}`,
      );
    }
    if (pass.params.length > PARAM_COUNT) {
      throw new Error(
        `GPU pass ${index} has ${pass.params.length} params; maximum is ${PARAM_COUNT}`,
      );
    }
    if (pass.integerParams && pass.integerParams.length > INTEGER_PARAM_COUNT) {
      throw new Error(
        `GPU pass ${index} has ${pass.integerParams.length} integer params; maximum is ${INTEGER_PARAM_COUNT}`,
      );
    }
    if (pass.palette && pass.palette.length > MAX_PALETTE * 3) {
      throw new Error(`GPU pass ${index} palette exceeds ${MAX_PALETTE} colours`);
    }

    const inputs: PlannedEffectPass['inputs'] = [];
    const seenInputs = new Set<string>();
    for (const inputName of pass.textures.slice(1)) {
      if (seenInputs.has(inputName)) {
        throw new Error(`GPU pass ${index} samples ${inputName} more than once`);
      }
      seenInputs.add(inputName);
      if (inputName === output) {
        throw new Error(`GPU pass ${index} reads and writes ${output} in the same pass`);
      }
      const inputSize = produced.get(inputName);
      if (!inputSize) {
        throw new Error(`GPU pass ${index} samples ${inputName} before it is produced`);
      }
      inputs.push({ name: inputName, ...inputSize });
    }

    planned.push({ pass, width, height, inputs });
    produced.set(output, { width, height });
  }
  return planned;
}

export interface ShaderDiagnosticMessage {
  type?: string;
  message?: string;
  lineNum?: number;
  linePos?: number;
}

/** Format browser shader diagnostics without discarding source locations. */
export function formatShaderDiagnostics(messages: readonly ShaderDiagnosticMessage[]): string {
  return messages
    .map((message) => {
      const location =
        Number.isFinite(message.lineNum) && Number.isFinite(message.linePos)
          ? `:${message.lineNum}:${message.linePos}`
          : '';
      return `${message.type ?? 'message'}${location}: ${message.message ?? 'unknown shader diagnostic'}`;
    })
    .join('\n');
}

function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/** Common helpers kernels use to pack params into the f32 array. */
export const pack = {
  f: (out: Float32Array, offset: number, v: unknown, dflt: number): number => {
    out[offset] = num(v, dflt);
    return offset + 1;
  },
  b: (out: Float32Array, offset: number, v: unknown, dflt: boolean): number => {
    out[offset] = typeof v === 'boolean' ? (v ? 1 : 0) : dflt ? 1 : 0;
    return offset + 1;
  },
  u32: (v: unknown, dflt: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) >>> 0 : dflt >>> 0,
  rgb: (
    out: Float32Array,
    offset: number,
    v: unknown,
    dflt: [number, number, number] | null,
  ): number => {
    if (Array.isArray(v) && v.length >= 3) {
      out[offset] = num(v[0], 0) / 255;
      out[offset + 1] = num(v[1], 0) / 255;
      out[offset + 2] = num(v[2], 0) / 255;
    } else if (dflt) {
      out[offset] = dflt[0] / 255;
      out[offset + 1] = dflt[1] / 255;
      out[offset + 2] = dflt[2] / 255;
    } else {
      out[offset] = 1;
      out[offset + 1] = 1;
      out[offset + 2] = 1;
    }
    return offset + 3;
  },
  palette: (colors: unknown, max: number): Float32Array => {
    const flat = new Float32Array(max * 3);
    if (Array.isArray(colors)) {
      let i = 0;
      for (const c of colors) {
        if (i >= max) break;
        if (Array.isArray(c) && c.length >= 3) {
          flat[i * 3] = num(c[0], 0) / 255;
          flat[i * 3 + 1] = num(c[1], 0) / 255;
          flat[i * 3 + 2] = num(c[2], 0) / 255;
        }
        i += 1;
      }
    }
    return flat;
  },
};
/** Small stable code for enum-ish string params (mode, algorithm, ...). */
export function stringCode(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Resolve a serialized quality param against the caller tier. */
export function resolveQuality(
  params: Record<string, unknown>,
  caller: EffectQuality,
): EffectQuality {
  const q = params.quality;
  if (q === 'interactive' || q === 'normal' || q === 'export') return q;
  return caller;
}

function cloneParamValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneParamValue);
  if (value instanceof Float32Array) return new Float32Array(value);
  if (value instanceof Uint32Array) return new Uint32Array(value);
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) copy[key] = cloneParamValue(nested);
    return copy;
  }
  return value;
}

/** Snapshot serialized request data before it waits behind another GPU job. */
export function snapshotEffectDispatchRequest(
  request: EffectDispatchRequest,
): EffectDispatchRequest {
  return {
    ...request,
    coordSpace: request.coordSpace ? { ...request.coordSpace } : undefined,
    params: cloneParamValue(request.params) as Record<string, unknown>,
  };
}

export class GpuEffectRunner {
  readonly id = 'webgpu-effects';
  private device: GPUDevice | null = null;
  private adapterIsFallback = false;
  private samplerLinear: GPUSampler | null = null;
  private samplerNearest: GPUSampler | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private integerBuffer: GPUBuffer | null = null;
  private paletteBuffer: GPUBuffer | null = null;
  private paramsLayout: GPUBindGroupLayout | null = null;
  private paletteLayout: GPUBindGroupLayout | null = null;
  private kernels = new Map<string, GpuKernelSpec>();
  private modules = new Map<string, GPUShaderModule>();
  private pipelines = new Map<string, GPUComputePipeline>();
  private pool = new Map<string, GPUTexture>();
  private poolBytes = 0;
  private readback: GPUBuffer | null = null;
  private readbackSize = 0;
  private ready = false;
  private deviceGeneration = 0;
  private initPromise: Promise<boolean> | null = null;
  private serialQueue: Promise<void> = Promise.resolve();
  private activeTextureKeys: Set<string> | null = null;

  private static readonly MAX_POOL_BYTES = 64 * 1024 * 1024;

  register(kernel: GpuKernelSpec): void {
    const previous = this.kernels.get(kernel.id);
    if (previous && previous.wgsl !== kernel.wgsl) {
      for (const key of this.modules.keys()) {
        if (key.startsWith(`${kernel.id}|`)) this.modules.delete(key);
      }
      for (const key of this.pipelines.keys()) {
        if (key.startsWith(`${kernel.id}|`)) this.pipelines.delete(key);
      }
    }
    this.kernels.set(kernel.id, kernel);
  }

  async init(options?: { requireHardwareAdapter?: boolean }): Promise<boolean> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initInternal(options).finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async initInternal(options?: { requireHardwareAdapter?: boolean }): Promise<boolean> {
    if (this.ready) return true;
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try {
      const selection = await selectWebGpuAdapter(navigator.gpu, {
        requireHardwareAdapter: options?.requireHardwareAdapter ?? true,
      });
      if (selection.kind === 'declined-software') {
        this.adapterIsFallback = true;
        return false;
      }
      if (selection.kind === 'unavailable') return false;
      const device = await selection.adapter.requestDevice();
      this.adapterIsFallback = selection.isFallbackAdapter;
      this.deviceGeneration += 1;
      this.device = device;
      this.watchDeviceLost(device);
      this.samplerLinear = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this.samplerNearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      this.paramsBuffer = device.createBuffer({
        size: PARAM_COUNT * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.integerBuffer = device.createBuffer({
        label: 'gpu-effects:integer-params',
        size: INTEGER_PARAM_COUNT * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.paletteBuffer = device.createBuffer({
        size: MAX_PALETTE * 3 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.paramsLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage', minBindingSize: PARAM_COUNT * 4 },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage', minBindingSize: INTEGER_PARAM_COUNT * 4 },
          },
        ],
      });
      this.paletteLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage', minBindingSize: MAX_PALETTE * 3 * 4 },
          },
        ],
      });
      device.addEventListener('uncapturederror', (event) => {
        console.error(
          '[gpu-effects] uncaptured error:',
          (event as GPUUncapturedErrorEvent).error?.message,
        );
      });
      this.ready = true;
      return true;
    } catch {
      this.destroy();
      return false;
    }
  }

  get diagnostics(): { ready: boolean; adapterIsFallback: boolean } {
    return { ready: this.ready, adapterIsFallback: this.adapterIsFallback };
  }

  private assertReady(): void {
    if (!this.ready || !this.device || !this.samplerLinear || !this.samplerNearest) {
      throw new Error('GpuEffectRunner is not initialized');
    }
  }

  private assertGeneration(device: GPUDevice, generation: number): void {
    if (!this.ready || this.device !== device || this.deviceGeneration !== generation) {
      throw new Error('WebGPU device generation is no longer current');
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.serialQueue.then(job, job);
    this.serialQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private getTexture(name: string, width: number, height: number): GPUTexture {
    assertPositiveDimensions(width, height, `Texture ${name}`);
    const key = `${name}:${width}x${height}`;
    let tex = this.pool.get(key);
    if (tex) {
      // Map insertion order is the small LRU used by the bounded texture pool.
      this.pool.delete(key);
      this.pool.set(key, tex);
      return tex;
    }
    const device = this.device!;
    tex = device.createTexture({
      label: `gpu-effects:${name}:${width}x${height}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    });
    this.pool.set(key, tex);
    this.poolBytes += width * height * 4;
    this.trimTexturePool();
    return tex;
  }

  /** Evict only textures that are not required by the in-flight pass plan. */
  private trimTexturePool(): void {
    while (this.poolBytes > GpuEffectRunner.MAX_POOL_BYTES && this.pool.size > 1) {
      let evicted = false;
      for (const [oldestKey, oldest] of this.pool) {
        if (this.activeTextureKeys?.has(oldestKey)) continue;
        this.pool.delete(oldestKey);
        oldest.destroy();
        const size = oldestKey.match(/:(\d+)x(\d+)$/);
        if (size) {
          this.poolBytes = Math.max(0, this.poolBytes - Number(size[1]) * Number(size[2]) * 4);
        }
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  private async pipelineFor(kernelId: string, pass: EffectPass): Promise<GPUComputePipeline> {
    const device = this.device!;
    const kernel = this.kernels.get(kernelId);
    if (!kernel) throw new Error(`Unknown GPU kernel: ${kernelId}`);
    const sampledCount = Math.max(0, pass.textures.length - 1);
    const sourceKey = `${kernel.wgsl.length}-${stringCode(kernel.wgsl).toString(16)}`;
    const key = `${kernelId}|${sourceKey}|${this.deviceGeneration}|${pass.entry}|${sampledCount}|${pass.sampler}|rgba8unorm`;
    let pipeline = this.pipelines.get(key);
    if (pipeline) return pipeline;

    const moduleKey = `${kernelId}|${sourceKey}|${this.deviceGeneration}`;
    let module = this.modules.get(moduleKey);
    if (!module) {
      module = device.createShaderModule({
        label: `gpu-effects:${kernelId}`,
        code: kernel.wgsl,
      });
      if (typeof module.getCompilationInfo === 'function') {
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter((message) => message.type === 'error');
        if (errors.length > 0) {
          throw new Error(
            `Shader compilation failed for ${kernelId}:\n${formatShaderDiagnostics(errors)}`,
          );
        }
      }
      this.modules.set(moduleKey, module);
    }

    const textureEntries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' },
      },
    ];
    for (let i = 0; i < sampledCount; i += 1) {
      textureEntries.push({
        binding: i + 1,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'float', viewDimension: '2d' },
      });
    }
    if (sampledCount > 0) {
      textureEntries.push({
        binding: sampledCount + 1,
        visibility: GPUShaderStage.COMPUTE,
        sampler: {},
      });
    }
    const textureLayout = device.createBindGroupLayout({ entries: textureEntries });
    const layoutGroups = [this.paramsLayout!, this.paletteLayout!, textureLayout];
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: layoutGroups,
    });
    let creationError: unknown;
    let validationScopePushed = false;
    if (typeof device.pushErrorScope === 'function') {
      device.pushErrorScope('validation');
      validationScopePushed = true;
    }
    try {
      pipeline = device.createComputePipeline({
        label: `gpu-effects:${kernelId}:${pass.entry}`,
        layout: pipelineLayout,
        compute: { module, entryPoint: pass.entry },
      });
    } catch (error) {
      creationError = error;
    }
    if (validationScopePushed) {
      const validationError = await device.popErrorScope();
      if (validationError) {
        throw new Error(
          `Pipeline validation failed for ${kernelId}/${pass.entry}: ${validationError.message}`,
        );
      }
    }
    if (creationError) throw creationError;
    if (!pipeline)
      throw new Error(`Pipeline creation returned no pipeline for ${kernelId}/${pass.entry}`);
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  /**
   * Apply a GPU kernel. Returns the RGBA result or throws (unsupported
   * requests throw before any GPU work — the caller falls back to CPU).
   */
  async apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray> {
    // A queued request must own its source bytes. Callers commonly reuse a
    // worker/ImageData buffer for the next preview while this job is waiting
    // behind an export; reading that mutable buffer later would mix documents.
    const input = new Uint8ClampedArray(rgba);
    const snapshot = snapshotEffectDispatchRequest(request);
    return this.enqueue(() => this.applyInternal(snapshot, input));
  }

  private async applyInternal(
    request: EffectDispatchRequest,
    rgba: Uint8ClampedArray,
  ): Promise<Uint8ClampedArray> {
    this.assertReady();
    const kernel = this.kernels.get(request.effect);
    if (!kernel) throw new Error(`No GPU kernel for ${request.effect}`);
    const device = this.device!;
    const generation = this.deviceGeneration;
    const { width, height } = request;
    if (rgba.length !== width * height * 4) {
      throw new Error(
        `GPU effect input has ${rgba.length} bytes; expected ${width * height * 4} for ${width}x${height}`,
      );
    }

    const passes = kernel.buildPasses(request, { width, height });
    const planned = planEffectPasses(passes, { width, height });
    this.assertGeneration(device, generation);
    const needsSrc = planned.some((plan) => plan.inputs.some((input) => input.name === 'src'));
    const activeTextureKeys = new Set<string>();
    if (needsSrc) activeTextureKeys.add(`src:${width}x${height}`);
    for (const plan of planned) {
      activeTextureKeys.add(`${plan.pass.textures[0]!}:${plan.width}x${plan.height}`);
      for (const input of plan.inputs) {
        if (input.name !== 'src')
          activeTextureKeys.add(`${input.name}:${input.width}x${input.height}`);
      }
    }
    this.activeTextureKeys = activeTextureKeys;

    try {
      const srcTex = needsSrc ? this.getTexture('src', width, height) : null;
      if (needsSrc) {
        device.queue.writeTexture(
          { texture: srcTex! },
          rgba as unknown as GPUAllowSharedBufferSource,
          { bytesPerRow: width * 4, rowsPerImage: height },
          { width, height },
        );
      }

      const paramsBuffer = this.paramsBuffer;
      const integerBuffer = this.integerBuffer;
      const paletteBuffer = this.paletteBuffer;
      const paramsLayout = this.paramsLayout;
      const paletteLayout = this.paletteLayout;
      const samplerLinear = this.samplerLinear;
      const samplerNearest = this.samplerNearest;
      if (
        (!srcTex && needsSrc) ||
        !paramsBuffer ||
        !integerBuffer ||
        !paletteBuffer ||
        !paramsLayout ||
        !paletteLayout ||
        !samplerLinear ||
        !samplerNearest
      ) {
        throw new Error('WebGPU effect resources are incomplete');
      }
      const paramsBindGroup = device.createBindGroup({
        layout: paramsLayout,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: { buffer: integerBuffer } },
        ],
      });

      let validationScopePushed = false;
      if (typeof device.pushErrorScope === 'function') {
        device.pushErrorScope('validation');
        validationScopePushed = true;
      }
      try {
        for (const plan of planned) {
          this.assertGeneration(device, generation);
          const { pass, width: texW, height: texH } = plan;
          const pipeline = await this.pipelineFor(kernel.id, pass);
          this.assertGeneration(device, generation);

          const padded = new Float32Array(PARAM_COUNT);
          padded.set(pass.params);
          device.queue.writeBuffer(paramsBuffer, 0, padded);
          const integers = new Uint32Array(INTEGER_PARAM_COUNT);
          if (pass.integerParams) integers.set(pass.integerParams);
          device.queue.writeBuffer(integerBuffer, 0, integers);
          const paddedPalette = new Float32Array(MAX_PALETTE * 3);
          if (pass.palette) paddedPalette.set(pass.palette);
          device.queue.writeBuffer(paletteBuffer, 0, paddedPalette);
          // Always bind the palette group. The explicit group is part of the
          // runner contract even when a particular module does not read it.
          const paletteBindGroup = device.createBindGroup({
            layout: paletteLayout,
            entries: [{ binding: 0, resource: { buffer: paletteBuffer } }],
          });

          const writeTarget = this.getTexture(pass.textures[0]!, texW, texH);
          const bindEntries: GPUBindGroupEntry[] = [
            { binding: 0, resource: writeTarget.createView() },
          ];
          for (let i = 0; i < plan.inputs.length; i += 1) {
            const input = plan.inputs[i]!;
            const tex =
              input.name === 'src'
                ? srcTex
                : this.getTexture(input.name, input.width, input.height);
            if (!tex) throw new Error(`GPU pass ${pass.entry} could not bind source ${input.name}`);
            bindEntries.push({ binding: i + 1, resource: tex.createView() });
          }
          if (plan.inputs.length > 0) {
            bindEntries.push({
              binding: plan.inputs.length + 1,
              resource: pass.sampler === 'linear' ? samplerLinear : samplerNearest,
            });
          }
          const textureLayout2 = pipeline.getBindGroupLayout(2);
          const textureBindGroup = device.createBindGroup({
            layout: textureLayout2,
            entries: bindEntries,
          });

          const dispatchX = Math.ceil(texW / pass.workgroup[0]);
          const dispatchY = Math.ceil(texH / pass.workgroup[1]);
          // One layer: the pass writes a single 2D storage texture, and
          // planEffectPasses rejects any pass whose workgroup z is not 1.
          const dispatchZ = 1;
          const maxWorkgroups = device.limits.maxComputeWorkgroupsPerDimension;
          if (dispatchX > maxWorkgroups || dispatchY > maxWorkgroups || dispatchZ > maxWorkgroups) {
            throw new Error(
              `GPU pass ${pass.entry} exceeds the workgroup limit (${dispatchX}x${dispatchY}x${dispatchZ}; max ${maxWorkgroups})`,
            );
          }
          const encoder = device.createCommandEncoder({
            label: `gpu-effects:${kernel.id}:${pass.entry}`,
          });
          const passEnc = encoder.beginComputePass({ label: pass.entry });
          passEnc.setPipeline(pipeline);
          passEnc.setBindGroup(0, paramsBindGroup);
          passEnc.setBindGroup(1, paletteBindGroup);
          passEnc.setBindGroup(2, textureBindGroup);
          passEnc.dispatchWorkgroups(dispatchX, dispatchY, dispatchZ);
          passEnc.end();
          device.queue.submit([encoder.finish()]);
        }

        // Read back the final pass's write target.
        const lastPass = planned[planned.length - 1]!;
        const outW = lastPass.width;
        const outH = lastPass.height;
        const outTex = this.getTexture(lastPass.pass.textures[0]!, outW, outH);
        const bytesPerRow = Math.max(256, Math.ceil((outW * 4) / 256) * 256);
        const bytes = bytesPerRow * outH;
        if (!this.readback || this.readbackSize < bytes) {
          this.readback?.destroy();
          this.readback = device.createBuffer({
            label: `gpu-effects:readback:${outW}x${outH}`,
            size: bytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          this.readbackSize = bytes;
        }
        const readback = this.readback;
        if (!readback) throw new Error('GPU effect readback buffer is unavailable');
        const encoder = device.createCommandEncoder({ label: 'gpu-effects:readback' });
        encoder.copyTextureToBuffer(
          { texture: outTex },
          { buffer: readback, bytesPerRow },
          { width: outW, height: outH },
        );
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        if (validationScopePushed) {
          const validationError = await device.popErrorScope();
          validationScopePushed = false;
          if (validationError) {
            throw new Error(`GPU effect validation failed: ${validationError.message}`);
          }
        }
        this.assertGeneration(device, generation);
        await readback.mapAsync(GPUMapMode.READ);
        let mapped = false;
        try {
          mapped = true;
          const source = new Uint8ClampedArray(readback.getMappedRange());
          const result = new Uint8ClampedArray(outW * outH * 4);
          for (let y = 0; y < outH; y += 1) {
            const rowStart = y * bytesPerRow;
            result.set(source.subarray(rowStart, rowStart + outW * 4), y * outW * 4);
          }
          return result;
        } finally {
          if (mapped) readback.unmap();
        }
      } catch (error) {
        if (validationScopePushed) {
          validationScopePushed = false;
          try {
            const validationError = await device.popErrorScope();
            if (validationError) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`${message}; GPU validation: ${validationError.message}`);
            }
          } catch (scopeError) {
            if (scopeError instanceof Error && scopeError.message !== String(error)) {
              throw scopeError;
            }
          }
        }
        throw error;
      }
    } finally {
      if (this.activeTextureKeys === activeTextureKeys) this.activeTextureKeys = null;
      this.trimTexturePool();
    }
  }

  /** Debug: run a single-bind-group constant-fill pipeline (harness use). */
  async debugMini(width: number, height: number): Promise<string> {
    return this.enqueue(() => this.debugMiniInternal(width, height));
  }

  private async debugMiniInternal(width: number, height: number): Promise<string> {
    this.assertReady();
    const device = this.device!;
    const tex = this.getTexture('debugMiniOut', width, height);
    const shader = device.createShaderModule({
      code: `
@group(0) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  textureStore(dst, vec2i(gid.xy), vec4f(0.2, 0.4, 0.6, 1.0));
}
`,
    });
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' },
        },
      ],
    });
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: shader, entryPoint: 'main' },
    });
    const bg = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: tex.createView() }],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), 1);
    pass.end();
    device.queue.submit([enc.finish()]);
    const bytesPerRow = Math.max(256, Math.ceil((width * 4) / 256) * 256);
    const buf = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc2 = device.createCommandEncoder();
    enc2.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, { width, height });
    device.queue.submit([enc2.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buf.mapAsync(GPUMapMode.READ);
    const out = Array.from(new Uint8ClampedArray(buf.getMappedRange()).slice(0, 16)).join(',');
    buf.unmap();
    buf.destroy();
    return out;
  }

  /** Debug: read back a pooled texture's raw bytes (harness use). */
  async readTextureRaw(name: string, width: number, height: number): Promise<string> {
    return this.enqueue(() => this.readTextureRawInternal(name, width, height));
  }

  private async readTextureRawInternal(
    name: string,
    width: number,
    height: number,
  ): Promise<string> {
    this.assertReady();
    const device = this.device!;
    const tex = this.getTexture(name, width, height);
    const bytesPerRow = Math.max(256, Math.ceil((width * 4) / 256) * 256);
    const buf = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, { width, height });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buf.mapAsync(GPUMapMode.READ);
    const out = Array.from(new Uint8ClampedArray(buf.getMappedRange()).slice(0, 16)).join(',');
    buf.unmap();
    buf.destroy();
    return out;
  }

  destroy(): void {
    this.releaseDeviceResources(true);
  }

  /**
   * A lost device invalidates every child resource. Drop all cached GPU
   * objects synchronously and clear the shared runner so the next optional
   * effect request can re-probe from a fresh adapter. Intentional `destroy()`
   * calls are ignored by the identity guard in the callback.
   */
  private watchDeviceLost(device: GPUDevice): void {
    const lost = device.lost;
    if (!lost || typeof lost.then !== 'function') return;
    void lost
      .then(() => {
        if (this.device !== device) return;
        this.releaseDeviceResources(false);
        if (sharedRunner === this) sharedRunner = null;
      })
      .catch(() => undefined);
  }

  private releaseDeviceResources(destroyDevice: boolean): void {
    for (const tex of this.pool.values()) tex.destroy();
    this.pool.clear();
    this.poolBytes = 0;
    this.pipelines.clear();
    this.modules.clear();
    this.readback?.destroy();
    this.readback = null;
    this.readbackSize = 0;
    this.paramsBuffer?.destroy();
    this.paramsBuffer = null;
    this.integerBuffer?.destroy();
    this.integerBuffer = null;
    this.paletteBuffer?.destroy();
    this.paletteBuffer = null;
    const device = this.device;
    if (destroyDevice) device?.destroy();
    this.device = null;
    this.samplerLinear = null;
    this.samplerNearest = null;
    this.paramsLayout = null;
    this.paletteLayout = null;
    this.ready = false;
    this.deviceGeneration += 1;
  }
}

let sharedRunner: GpuEffectRunner | null = null;
let sharedRunnerPromise: Promise<GpuEffectRunner | null> | null = null;

/** Lazily-initialized process-wide runner (export-path default). */
export async function getSharedEffectRunner(): Promise<GpuEffectRunner | null> {
  if (sharedRunner) return sharedRunner;
  if (sharedRunnerPromise) return sharedRunnerPromise;
  sharedRunnerPromise = (async () => {
    const runner = new GpuEffectRunner();
    const ok = await runner.init();
    if (!ok) {
      runner.destroy();
      return null;
    }
    sharedRunner = runner;
    return runner;
  })().finally(() => {
    sharedRunnerPromise = null;
  });
  return sharedRunnerPromise;
}
