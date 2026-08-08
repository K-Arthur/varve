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
 * are allocated from a per-run pool keyed by name + size.
 *
 * Dawn build quirks observed on Chromium 1228 headless + RADV (all three
 * bite SILENTLY — dispatch runs, texture stays uninitialized, no error):
 * - storage buffers MUST be declared `var<storage, read_write>` in kernels;
 *   `read`-only storage buffers no-op the dispatch.
 * - the shader entry point must EXACTLY match `pass.entry` — a missing
 *   entry point no-ops instead of throwing.
 * - the palette bind group is always bound (even for passes without a
 *   palette) because unbound group layouts can no-op the dispatch.
 */

import type { CoordSpace, EffectQuality } from '@varve/engine';
import { selectWebGpuAdapter } from '@varve/engine/gpuAdapter';

export interface EffectPass {
  /** WGSL entry point (the kernel module may hold several passes). */
  entry: string;
  /** Packed f32 params (kernel-specific layout, <= 128 values). */
  params: Float32Array;
  /** Optional palette triplets (0..1); absent = no palette binding. */
  palette?: Float32Array;
  /** Texture bindings: index 0 = write target; 1+ = sampled textures. */
  textures: string[];
  /** Sampler for sampled textures: 'linear' | 'nearest'. */
  sampler: 'linear' | 'nearest';
  /** Workgroup size for the dispatch. */
  workgroup: [number, number, number];
  /** Texture sizes for the write target; default = full surface. */
  size?: { width: number; height: number };
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
const MAX_PALETTE = 128;
const FULL_RES = Symbol('full-res');

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

export class GpuEffectRunner {
  readonly id = 'webgpu-effects';
  private device: GPUDevice | null = null;
  private adapterIsFallback = false;
  private samplerLinear: GPUSampler | null = null;
  private samplerNearest: GPUSampler | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private paletteBuffer: GPUBuffer | null = null;
  private paramsLayout: GPUBindGroupLayout | null = null;
  private paletteLayout: GPUBindGroupLayout | null = null;
  private kernels = new Map<string, GpuKernelSpec>();
  private modules = new Map<string, GPUShaderModule>();
  private pipelines = new Map<string, GPUComputePipeline>();
  private pool = new Map<string, GPUTexture>();
  private readback: GPUBuffer | null = null;
  private readbackSize = 0;
  private ready = false;

  register(kernel: GpuKernelSpec): void {
    this.kernels.set(kernel.id, kernel);
  }

  async init(options?: { requireHardwareAdapter?: boolean }): Promise<boolean> {
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
      this.device = device;
      this.samplerLinear = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this.samplerNearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      this.paramsBuffer = device.createBuffer({
        size: PARAM_COUNT * 4,
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
            buffer: { type: 'storage', minBindingSize: PARAM_COUNT * 4 },
          },
        ],
      });
      this.paletteLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'storage', minBindingSize: MAX_PALETTE * 3 * 4 },
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

  private getTexture(name: string, width: number, height: number): GPUTexture {
    const key = `${name}:${width}x${height}`;
    let tex = this.pool.get(key);
    if (!tex) {
      const device = this.device!;
      tex = device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC,
      });
      this.pool.set(key, tex);
    }
    return tex;
  }

  private pipelineFor(kernelId: string, pass: EffectPass): GPUComputePipeline {
    const device = this.device!;
    const sampledCount = Math.max(0, pass.textures.length - 1);
    const key = `${kernelId}|${pass.entry}|${sampledCount}|${pass.sampler}`;
    let pipeline = this.pipelines.get(key);
    if (pipeline) return pipeline;

    let module = this.modules.get(kernelId);
    if (!module) {
      const kernel = this.kernels.get(kernelId);
      if (!kernel) throw new Error(`Unknown GPU kernel: ${kernelId}`);
      module = device.createShaderModule({ code: kernel.wgsl });
      this.modules.set(kernelId, module);
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
    try {
      pipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: pass.entry },
      });
    } catch (error) {
      console.error('[gpu-effects] pipeline creation failed:', (error as Error).message);
      throw error;
    }
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  /**
   * Apply a GPU kernel. Returns the RGBA result or throws (unsupported
   * requests throw before any GPU work — the caller falls back to CPU).
   */
  async apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray> {
    this.assertReady();
    const kernel = this.kernels.get(request.effect);
    if (!kernel) throw new Error(`No GPU kernel for ${request.effect}`);
    const device = this.device!;
    const { width, height } = request;

    const passes = kernel.buildPasses(request, { width, height });
    const needsSrc = passes.some((p) => p.textures.includes('src'));
    const srcTex = this.getTexture('src', width, height);
    if (needsSrc) {
      device.queue.writeTexture(
        { texture: srcTex },
        rgba,
        { bytesPerRow: width * 4 },
        { width, height },
      );
    }

    const paramsBindGroup = device.createBindGroup({
      layout: this.paramsLayout!,
      entries: [{ binding: 0, resource: { buffer: this.paramsBuffer! } }],
    });

    for (const pass of passes) {
      const texW = pass.size?.width ?? width;
      const texH = pass.size?.height ?? height;
      const pipeline = this.pipelineFor(kernel.id, pass);

      const padded = new Float32Array(PARAM_COUNT);
      padded.set(pass.params);
      device.queue.writeBuffer(this.paramsBuffer!, 0, padded);
      const paddedPalette = new Float32Array(MAX_PALETTE * 3);
      if (pass.palette) {
        paddedPalette.set(pass.palette);
      }
      device.queue.writeBuffer(this.paletteBuffer!, 0, paddedPalette);
      // Always bind the palette group: this Dawn build no-ops dispatches
      // whose pipeline declares an unbound bind-group layout.
      const paletteBindGroup = device.createBindGroup({
        layout: this.paletteLayout!,
        entries: [{ binding: 0, resource: { buffer: this.paletteBuffer! } }],
      });

      const writeTarget = this.getTexture(pass.textures[0]!, texW, texH);
      const bindEntries: GPUBindGroupEntry[] = [{ binding: 0, resource: writeTarget.createView() }];
      const sampledCount = pass.textures.length - 1;
      for (let i = 0; i < sampledCount; i += 1) {
        const texName = pass.textures[i + 1]!;
        const tex = texName === 'src' ? srcTex : this.getTexture(texName, texW, texH);
        bindEntries.push({ binding: i + 1, resource: tex.createView() });
      }
      if (sampledCount > 0) {
        bindEntries.push({
          binding: sampledCount + 1,
          resource: pass.sampler === 'linear' ? this.samplerLinear! : this.samplerNearest!,
        });
      }
      const textureLayout2 = pipeline.getBindGroupLayout(2);
      const textureBindGroup = device.createBindGroup({
        layout: textureLayout2,
        entries: bindEntries,
      });

      const encoder = device.createCommandEncoder();
      const passEnc = encoder.beginComputePass();
      passEnc.setPipeline(pipeline);
      passEnc.setBindGroup(0, paramsBindGroup);
      if (paletteBindGroup) passEnc.setBindGroup(1, paletteBindGroup);
      passEnc.setBindGroup(2, textureBindGroup);
      passEnc.dispatchWorkgroups(
        Math.ceil(texW / pass.workgroup[0]),
        Math.ceil(texH / pass.workgroup[1]),
        pass.workgroup[2],
      );
      passEnc.end();
      device.queue.submit([encoder.finish()]);
    }

    // Read back the final pass's write target.
    const lastPass = passes[passes.length - 1]!;
    const outSize = lastPass.size;
    const outW = outSize?.width ?? width;
    const outH = outSize?.height ?? height;
    const outTex = this.getTexture(lastPass.textures[0]!, outW, outH);
    // bytesPerRow must be a multiple of 256 (WebGPU texture-copy rule) —
    // both the buffer allocation and the copy must use the padded stride.
    const bytesPerRow = Math.max(256, Math.ceil((outW * 4) / 256) * 256);
    const bytes = bytesPerRow * outH;
    if (!this.readback || this.readbackSize < bytes) {
      this.readback?.destroy();
      this.readback = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.readbackSize = bytes;
    }
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: this.readback, bytesPerRow },
      { width: outW, height: outH },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await this.readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8ClampedArray(this.readback.getMappedRange());
    const result = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y += 1) {
      const rowStart = y * bytesPerRow;
      result.set(mapped.subarray(rowStart, rowStart + outW * 4), y * outW * 4);
    }
    this.readback.unmap();
    return result;
  }

  /** Debug: run a single-bind-group constant-fill pipeline (harness use). */
  async debugMini(width: number, height: number): Promise<string> {
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
    for (const tex of this.pool.values()) tex.destroy();
    this.pool.clear();
    this.pipelines.clear();
    this.modules.clear();
    this.readback?.destroy();
    this.readback = null;
    this.readbackSize = 0;
    this.paramsBuffer?.destroy();
    this.paramsBuffer = null;
    this.paletteBuffer?.destroy();
    this.paletteBuffer = null;
    this.paramsLayout = null;
    this.paletteLayout = null;
    this.device?.destroy();
    this.device = null;
    this.samplerLinear = null;
    this.samplerNearest = null;
    this.ready = false;
  }
}

let sharedRunner: GpuEffectRunner | null = null;

/** Lazily-initialized process-wide runner (export-path default). */
export async function getSharedEffectRunner(): Promise<GpuEffectRunner | null> {
  if (!sharedRunner) {
    const runner = new GpuEffectRunner();
    const ok = await runner.init();
    if (!ok) {
      runner.destroy();
      return null;
    }
    sharedRunner = runner;
  }
  return sharedRunner;
}
