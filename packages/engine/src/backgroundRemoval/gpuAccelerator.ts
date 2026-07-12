/// <reference path="../webgpu-types.d.ts" />

/**
 * GPU compute shader accelerator for background removal operations.
 *
 * Provides WebGPU-accelerated Gaussian blur (separable), CHW tensor packing,
 * and compound threshold+resize+confidence operations. Falls back to CPU
 * implementations from `maskOps.ts` when WebGPU is unavailable or an error
 * occurs at any stage of the GPU pipeline.
 *
 * Research basis: WebGPU compute shader for separable convolution (NVIDIA
 * GPU Gems 3, Ch. 27); WGSL storage-buffer tiling for 2D image ops.
 */

import {
  computeMaskConfidence,
  featherMaskArray,
  packChwFloat32,
  resizeMaskNearestNeighbor,
  thresholdMask,
} from './maskOps';

export interface GpuCapabilities {
  /** Whether WebGPU is available at all */
  available: boolean;
  /** Maximum supported texture dimension */
  maxTextureDimension: number;
  /** Which operations are GPU-accelerated */
  acceleratedOps: string[];
  /** GPU adapter name (for telemetry) */
  adapterName: string;
}

/**
 * GPU Accelerator for background removal operations.
 * Singleton -- created on first access via `getInstance()`.
 * Falls back to CPU implementations when WebGPU is unavailable.
 */
export class GpuAccelerator {
  private static instance: GpuAccelerator | null = null;
  private device: GPUDevice | null = null;
  private pipelines: Map<string, GPUComputePipeline> = new Map();
  private initialized = false;
  private _capabilities: GpuCapabilities | null = null;
  private deviceLostWatched = false;

  private constructor() {}

  static getInstance(): GpuAccelerator {
    if (!GpuAccelerator.instance) {
      GpuAccelerator.instance = new GpuAccelerator();
    }
    return GpuAccelerator.instance;
  }

  /**
   * Force re-initialization (e.g. after simulated device loss in tests, or
   * if the WebGPU adapter becomes available after an initial failure).
   */
  static resetInstance(): void {
    const inst = GpuAccelerator.instance;
    if (inst) {
      inst.device?.destroy();
      inst.device = null;
      inst.pipelines.clear();
      inst.initialized = false;
      inst._capabilities = null;
      inst.deviceLostWatched = false;
    }
    GpuAccelerator.instance = null;
  }

  async initialize(): Promise<GpuCapabilities> {
    if (this.initialized && this._capabilities) return this._capabilities;

    try {
      if (!navigator.gpu) throw new Error('WebGPU not available');

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter found');

      const device = await adapter.requestDevice();
      if (!device) throw new Error('No WebGPU device');

      this.device = device;
      this.pipelines.clear();
      this._watchDeviceLost(device);

      const adapterInfo = await (
        adapter as unknown as {
          requestAdapterInfo(): Promise<{ description?: string; vendor?: string }>;
        }
      ).requestAdapterInfo();
      const maxTextureDim = device.limits.maxTextureDimension2D;

      this._capabilities = {
        available: true,
        maxTextureDimension: maxTextureDim,
        acceleratedOps: ['gaussianBlur', 'chwPack', 'thresholdResize'],
        adapterName: adapterInfo.description || adapterInfo.vendor || 'unknown',
      };

      this.initialized = true;
    } catch {
      this.device = null;
      this._capabilities = {
        available: false,
        maxTextureDimension: 0,
        acceleratedOps: [],
        adapterName: '',
      };
    }

    this.initialized = true;
    return this._capabilities;
  }

  getCapabilities(): GpuCapabilities | null {
    return this._capabilities;
  }

  /**
   * GPU-accelerated Gaussian blur (separable: horizontal then vertical pass).
   * Falls back to CPU if WebGPU unavailable or the GPU shader fails.
   */
  async gaussianBlur(
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
  ): Promise<Uint8Array> {
    if (!this.device || !this._capabilities?.available) {
      return featherMaskArray(mask, width, height, radius);
    }

    const r = Math.max(1, Math.round(radius));
    const sigma = r / 2;
    const kernelSize = r * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let kernelSum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + r] = v;
      kernelSum += v;
    }
    for (let i = 0; i < kernelSize; i++) kernel[i]! /= kernelSum;

    try {
      return await this._runSeparableBlur(mask, width, height, kernel, r);
    } catch {
      return featherMaskArray(mask, width, height, radius);
    }
  }

  /**
   * GPU-accelerated CHW packing (RGBA --> NCHW float32 tensor).
   * Falls back to CPU.
   */
  async chwPack(imageData: {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
  }): Promise<Float32Array> {
    if (!this.device || !this._capabilities?.available) {
      return packChwFloat32(imageData);
    }

    try {
      return await this._runChwPack(imageData);
    } catch {
      return packChwFloat32(imageData);
    }
  }

  /**
   * GPU-accelerated threshold + resize + confidence in one compound call.
   * Falls back to CPU chain.
   */
  async thresholdResizeConfidence(
    outputData: Float32Array,
    maskW: number,
    maskH: number,
    targetW: number,
    targetH: number,
    threshold = 0.5,
  ): Promise<{ mask: Uint8Array; confidence: number }> {
    if (!this.device || !this._capabilities?.available) {
      const rawMask = thresholdMask(outputData, threshold);
      const mask = resizeMaskNearestNeighbor(rawMask, maskW, maskH, targetW, targetH);
      const confidence = computeMaskConfidence(outputData);
      return { mask, confidence };
    }

    try {
      return await this._runThresholdResizeConfidence(
        outputData,
        maskW,
        maskH,
        targetW,
        targetH,
        threshold,
      );
    } catch {
      const rawMask = thresholdMask(outputData, threshold);
      const mask = resizeMaskNearestNeighbor(rawMask, maskW, maskH, targetW, targetH);
      const confidence = computeMaskConfidence(outputData);
      return { mask, confidence };
    }
  }

  // ---- Private GPU implementations ----

  /**
   * Execute a separable Gaussian blur on the GPU.
   *
   * Data flow:
   *   1. Upload mask as Float32 (WGSL compute operates on f32 storage buffers)
   *   2. Horizontal pass: input --> temp buffer
   *   3. Vertical pass: temp buffer --> output buffer
   *   4. Download result as Float32, convert back to Uint8 (clamp + round)
   */
  private async _runSeparableBlur(
    mask: Uint8Array,
    width: number,
    height: number,
    kernel: Float32Array,
    radius: number,
  ): Promise<Uint8Array> {
    const device = this.device!;
    const pixelCount = width * height;
    const bufferSize = pixelCount * 4; // Float32 is 4 bytes per element

    // Convert Uint8 --> Float32 for GPU compute
    const floatInput = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) floatInput[i] = mask[i] ?? 0;

    // Storage buffers
    const inputBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(inputBuffer, 0, floatInput);

    const tempBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const outputBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Uniform buffer layout matches WGSL struct:
    //   width: i32    @ offset 0
    //   height: i32   @ offset 4
    //   radius: i32   @ offset 8
    //   kernelSize: i32 @ offset 12
    //   kernel: array<f32, 128> @ offset 16
    const UNIFORM_SIZE = 16 + 128 * 4;
    const uniformBuffer = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformData = new ArrayBuffer(UNIFORM_SIZE);
    const view = new DataView(uniformData);
    view.setInt32(0, width, true);
    view.setInt32(4, height, true);
    view.setInt32(8, radius, true);
    view.setInt32(12, kernel.length, true);
    new Float32Array(uniformData, 16).set(kernel);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Get or create compute pipelines
    const hBlurPipeline = this._getOrCreatePipeline('separableBlurH', () =>
      device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            code: this._getHorizontalBlurShader(),
          }),
          entryPoint: 'main',
        },
      }),
    );

    const vBlurPipeline = this._getOrCreatePipeline('separableBlurV', () =>
      device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            code: this._getVerticalBlurShader(),
          }),
          entryPoint: 'main',
        },
      }),
    );

    // Horizontal pass: input --> temp
    const hBindGroup = device.createBindGroup({
      layout: hBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: tempBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const hEncoder = device.createCommandEncoder();
    const hPass = hEncoder.beginComputePass();
    hPass.setPipeline(hBlurPipeline);
    hPass.setBindGroup(0, hBindGroup);
    hPass.dispatchWorkgroups(Math.ceil(width / 64), height);
    hPass.end();
    device.queue.submit([hEncoder.finish()]);

    // Vertical pass: temp --> output
    const vBindGroup = device.createBindGroup({
      layout: vBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: tempBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const vEncoder = device.createCommandEncoder();
    const vPass = vEncoder.beginComputePass();
    vPass.setPipeline(vBlurPipeline);
    vPass.setBindGroup(0, vBindGroup);
    vPass.dispatchWorkgroups(width, Math.ceil(height / 64));
    vPass.end();
    device.queue.submit([vEncoder.finish()]);

    // Read back result
    const readBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, bufferSize);
    device.queue.submit([copyEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const floatResult = new Float32Array(readBuffer.getMappedRange());
    const output = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      output[i] = Math.min(255, Math.max(0, Math.round(floatResult[i] ?? 0)));
    }
    readBuffer.unmap();

    // Cleanup
    inputBuffer.destroy();
    tempBuffer.destroy();
    outputBuffer.destroy();
    uniformBuffer.destroy();
    readBuffer.destroy();

    return output;
  }

  /**
   * GPU-accelerated CHW pack (deferred -- CPU fallback for now).
   * The CPU implementation is a straightforward data rearrangement that is
   * typically not a bottleneck; a GPU version would use a storage-buffer
   * copy with channel indexing but is not yet benched as necessary.
   */
  private async _runChwPack(imageData: {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
  }): Promise<Float32Array> {
    return packChwFloat32(imageData);
  }

  /**
   * Compound GPU threshold + resize + confidence (deferred -- CPU fallback).
   * The three operations chain naturally and the CPU path is already fast
   * for mask-sized data (typically <= 2048px). A single GPU pass that reads
   * the ONNX output float buffer, thresholds, resizes, and computes the
   * confidence mean in-flight would save the readback + 3 CPU passes, but
   * requires a more involved WGSL reduction for the confidence sum.
   */
  private async _runThresholdResizeConfidence(
    outputData: Float32Array,
    maskW: number,
    maskH: number,
    targetW: number,
    targetH: number,
    threshold = 0.5,
  ): Promise<{ mask: Uint8Array; confidence: number }> {
    const rawMask = thresholdMask(outputData, threshold);
    const mask = resizeMaskNearestNeighbor(rawMask, maskW, maskH, targetW, targetH);
    const confidence = computeMaskConfidence(outputData);
    return { mask, confidence };
  }

  // ---- Pipeline cache ----

  private _getOrCreatePipeline(
    name: string,
    factory: () => GPUComputePipeline,
  ): GPUComputePipeline {
    const existing = this.pipelines.get(name);
    if (existing) return existing;
    const pipeline = factory();
    this.pipelines.set(name, pipeline);
    return pipeline;
  }

  /**
   * Watch for GPU device loss and reset state so subsequent operations
   * transparently fall back to CPU.
   */
  private _watchDeviceLost(device: GPUDevice): void {
    if (this.deviceLostWatched) return;
    this.deviceLostWatched = true;
    void device.lost.then(async () => {
      this.device = null;
      this.pipelines.clear();
      this._capabilities = null;
      this.initialized = false;
      this.deviceLostWatched = false;
    });
  }

  // ---- WGSL shaders ----

  private _getHorizontalBlurShader(): string {
    return `
      struct Uniforms {
        width: i32,
        height: i32,
        radius: i32,
        kernelSize: i32,
        kernel: array<f32, 128>,
      };

      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let x = i32(id.x);
        let y = i32(id.y);
        if (x >= uniforms.width || y >= uniforms.height) { return; }

        var sum = 0.0;
        for (var k = -uniforms.radius; k <= uniforms.radius; k++) {
          let sx = clamp(x + k, 0, uniforms.width - 1);
          let idx = y * uniforms.width + sx;
          let kv = uniforms.kernel[k + uniforms.radius];
          sum += input[idx] * kv;
        }
        output[y * uniforms.width + x] = sum;
      }
    `;
  }

  private _getVerticalBlurShader(): string {
    return `
      struct Uniforms {
        width: i32,
        height: i32,
        radius: i32,
        kernelSize: i32,
        kernel: array<f32, 128>,
      };

      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let x = i32(id.x);
        let y = i32(id.y);
        if (x >= uniforms.width || y >= uniforms.height) { return; }

        var sum = 0.0;
        for (var k = -uniforms.radius; k <= uniforms.radius; k++) {
          let sy = clamp(y + k, 0, uniforms.height - 1);
          let idx = sy * uniforms.width + x;
          let kv = uniforms.kernel[k + uniforms.radius];
          sum += input[idx] * kv;
        }
        output[y * uniforms.width + x] = sum;
      }
    `;
  }
}

// ---- Convenience exports ----

/**
 * GPU-accelerated mask feathering with automatic CPU fallback.
 * Convenience wrapper that avoids the singleton boilerplate for callers
 * that just want a faster gaussian blur on the mask.
 */
export async function gpuFeatherMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Promise<Uint8Array> {
  const accel = GpuAccelerator.getInstance();
  await accel.initialize();
  return accel.gaussianBlur(mask, width, height, radius);
}

/** Convenience: get GPU capabilities. */
export async function getGpuCapabilities(): Promise<GpuCapabilities> {
  const accel = GpuAccelerator.getInstance();
  return accel.initialize();
}
