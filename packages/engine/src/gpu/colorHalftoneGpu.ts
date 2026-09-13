/**
 * GPU-accelerated Color Halftone via WebGPU compute shader.
 *
 * Architecture:
 *   1. Source ImageData uploaded to GPU texture (rgba8unorm).
 *   2. WGSL compute shader screens each pixel per-channel.
 *   3. Result read back as ImageData for compositing.
 *   4. Falls through to CPU if WebGPU unavailable or image is small.
 */

import { initGpuCapability, invalidateGpuCapability } from '../adjustmentPipeline';
import { applyColorHalftone, type ColorHalftoneParams } from '../colorHalftone';
import { COLOR_HALFTONE_COMPUTE_WGSL } from './colorHalftone.wgsl';

const MODE_MAP: Record<string, number> = { cmyk: 0, rgb: 1, mono: 2 };
const DOTSHAPE_MAP: Record<string, number> = { round: 0, square: 1, diamond: 2, line: 3 };

const CMYK_ANGLES_RAD = [
  (15 * Math.PI) / 180,
  (75 * Math.PI) / 180,
  (0 * Math.PI) / 180,
  (45 * Math.PI) / 180,
];

const RGB_ANGLES_RAD = [(0 * Math.PI) / 180, (30 * Math.PI) / 180, (60 * Math.PI) / 180];

/**
 * Size of the CHParams struct in bytes:
 *   screenSize(f32) + intensity(f32) + mode(u32) + dotShape(u32) +
 *   angle0(f32) + angle1(f32) + angle2(f32) + angle3(f32) +
 *   inkR(f32) + inkG(f32) + inkB(f32) + inkA(f32)
 * = 4*12 = 48 bytes. WGSL aligns struct size to 16: 48 → 48 (already 16-aligned).
 */
const UNIFORM_SIZE = 48;
const GPU_COPY_BYTES_PER_ROW_ALIGNMENT = 256;

export interface Rgba8TextureReadbackLayout {
  rowBytes: number;
  bytesPerRow: number;
  bufferSize: number;
}

/**
 * Resolve the WebGPU texture-copy layout for a tightly packed RGBA8 image.
 * `copyTextureToBuffer` requires a 256-byte row stride even when the logical
 * source row is narrower.
 */
export function rgba8TextureReadbackLayout(
  width: number,
  height: number,
): Rgba8TextureReadbackLayout {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`RGBA8 readback dimensions must be positive integers (${width}x${height})`);
  }
  const rowBytes = width * 4;
  const bytesPerRow = Math.max(
    GPU_COPY_BYTES_PER_ROW_ALIGNMENT,
    Math.ceil(rowBytes / GPU_COPY_BYTES_PER_ROW_ALIGNMENT) * GPU_COPY_BYTES_PER_ROW_ALIGNMENT,
  );
  return { rowBytes, bytesPerRow, bufferSize: bytesPerRow * height };
}

/** Remove WebGPU's padded rows without exposing padding as image pixels. */
export function unpackRgba8TextureReadback(
  mapped: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const layout = rgba8TextureReadbackLayout(width, height);
  if (mapped.byteLength < layout.bufferSize) {
    throw new Error(
      `RGBA8 readback is too small (${mapped.byteLength} bytes; expected ${layout.bufferSize})`,
    );
  }
  const result = new Uint8ClampedArray(layout.rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * layout.bytesPerRow;
    result.set(mapped.subarray(sourceStart, sourceStart + layout.rowBytes), y * layout.rowBytes);
  }
  return result;
}

export interface ColorHalftoneGpuDiagnostics {
  backend: 'webgpu' | 'cpu';
  width: number;
  height: number;
  reason: string;
}

let lastDiagnostics: ColorHalftoneGpuDiagnostics = {
  backend: 'cpu',
  width: 0,
  height: 0,
  reason: 'not-run',
};

/** Backend evidence for production probes and export diagnostics. */
export function getColorHalftoneGpuDiagnostics(): ColorHalftoneGpuDiagnostics {
  return { ...lastDiagnostics };
}

// ── GPU pipeline management ────────────────────────────────────────────────

let gpuDevice: GPUDevice | null = null;
let gpuPipeline: GPUComputePipeline | null = null;
let gpuBindGroupLayout: GPUBindGroupLayout | null = null;
let gpuInitPromise: Promise<GPUDevice | null> | null = null;

async function ensureGpuDevice(): Promise<GPUDevice | null> {
  if (gpuDevice) return gpuDevice;

  if (gpuInitPromise) return gpuInitPromise;
  gpuInitPromise = ensureGpuDeviceInternal().finally(() => {
    gpuInitPromise = null;
  });
  return gpuInitPromise;
}

async function ensureGpuDeviceInternal(): Promise<GPUDevice | null> {
  if (gpuDevice) return gpuDevice;

  const capability = await initGpuCapability();
  if (capability.kind !== 'available') return null;

  gpuDevice = capability.device;
  watchGpuDeviceLost(gpuDevice);

  gpuBindGroupLayout = gpuDevice.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba8unorm' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });

  const pipelineLayout = gpuDevice.createPipelineLayout({
    bindGroupLayouts: [gpuBindGroupLayout],
  });

  const shaderModule = gpuDevice.createShaderModule({
    code: COLOR_HALFTONE_COMPUTE_WGSL,
  });

  if (typeof shaderModule.getCompilationInfo === 'function') {
    const info = await shaderModule.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length > 0) {
      const details = errors
        .map((message) => {
          const location =
            Number.isFinite(message.lineNum) && Number.isFinite(message.linePos)
              ? `:${message.lineNum}:${message.linePos}`
              : '';
          return `${message.type}${location}: ${message.message}`;
        })
        .join('\n');
      throw new Error(`Color Halftone shader compilation failed:\n${details}`);
    }
  }

  let validationError: GPUError | null = null;
  if (typeof gpuDevice.pushErrorScope === 'function') gpuDevice.pushErrorScope('validation');
  try {
    gpuPipeline = gpuDevice.createComputePipeline({
      label: 'varve:color-halftone',
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'main' },
    });
  } finally {
    if (typeof gpuDevice.popErrorScope === 'function') {
      validationError = await gpuDevice.popErrorScope();
    }
  }
  if (validationError)
    throw new Error(`Color Halftone pipeline validation failed: ${validationError.message}`);

  return gpuDevice;
}

function fillUniformBuffer(
  view: DataView,
  params: ColorHalftoneParams,
  channelAngles: Float32Array,
  inkColorNorm: Float32Array,
): void {
  let offset = 0;
  // screenSize: f32
  view.setFloat32(offset, params.screenSize, true);
  offset += 4;
  // intensity: f32
  view.setFloat32(offset, params.intensity, true);
  offset += 4;
  // mode: u32
  view.setUint32(offset, MODE_MAP[params.mode] ?? 2, true);
  offset += 4;
  // dotShape: u32
  view.setUint32(offset, DOTSHAPE_MAP[params.dotShape] ?? 0, true);
  offset += 4;
  // angle0..angle3: f32 × 4
  for (let i = 0; i < 4; i++) {
    view.setFloat32(offset, channelAngles[i] ?? 0, true);
    offset += 4;
  }
  // inkR, inkG, inkB, inkA: f32 × 4
  for (let i = 0; i < 4; i++) {
    view.setFloat32(offset, inkColorNorm[i] ?? 0, true);
    offset += 4;
  }
}

function resetGpuResources(): void {
  gpuPipeline = null;
  gpuBindGroupLayout = null;
  // The device comes from the shared capability manager. A failed halftone
  // submission must not destroy a device that another optional GPU operation
  // is using; device-loss recovery owns invalidation and re-probing.
  gpuDevice = null;
}

function watchGpuDeviceLost(device: GPUDevice): void {
  const lost = device.lost;
  if (!lost || typeof lost.then !== 'function') return;
  void lost
    .then(() => {
      if (gpuDevice !== device) return;
      resetGpuResources();
      invalidateGpuCapability(device);
    })
    .catch(() => undefined);
}

const GPU_MIN_PIXELS = 32 * 32;

export async function applyColorHalftoneGpu(
  data: ImageData,
  params: ColorHalftoneParams,
): Promise<ImageData> {
  if (params.intensity === 0) {
    lastDiagnostics = {
      backend: 'cpu',
      width: data.width,
      height: data.height,
      reason: 'identity',
    };
    return data;
  }
  if (data.width * data.height < GPU_MIN_PIXELS) {
    lastDiagnostics = {
      backend: 'cpu',
      width: data.width,
      height: data.height,
      reason: 'below-gpu-size-threshold',
    };
    return applyColorHalftone(data, params);
  }

  try {
    const device = await ensureGpuDevice();
    if (!device || !gpuPipeline || !gpuBindGroupLayout) {
      lastDiagnostics = {
        backend: 'cpu',
        width: data.width,
        height: data.height,
        reason: 'webgpu-unavailable',
      };
      return applyColorHalftone(data, params);
    }

    const result = await dispatchGpu(device, data, params);
    lastDiagnostics = {
      backend: 'webgpu',
      width: data.width,
      height: data.height,
      reason: 'compute-and-readback-complete',
    };
    return result;
  } catch (error) {
    resetGpuResources();
    lastDiagnostics = {
      backend: 'cpu',
      width: data.width,
      height: data.height,
      reason: error instanceof Error ? error.message : String(error),
    };
    return applyColorHalftone(data, params);
  }
}

async function dispatchGpu(
  device: GPUDevice,
  data: ImageData,
  params: ColorHalftoneParams,
): Promise<ImageData> {
  const w = data.width;
  const h = data.height;
  const inkColor = params.inkColor ?? [0, 0, 0, 255];
  const inkColorNorm = new Float32Array([
    inkColor[0] / 255,
    inkColor[1] / 255,
    inkColor[2] / 255,
    inkColor[3] / 255,
  ]);

  // Compute channel angles based on mode
  const baseRad = (params.angle * Math.PI) / 180;
  let channelAngles: Float32Array;
  if (params.mode === 'cmyk') {
    channelAngles = new Float32Array(CMYK_ANGLES_RAD.map((a) => a + baseRad));
  } else if (params.mode === 'rgb') {
    channelAngles = new Float32Array(RGB_ANGLES_RAD.map((a) => a + baseRad));
  } else {
    channelAngles = new Float32Array([baseRad, baseRad, baseRad, baseRad]);
  }

  let srcTexture: GPUTexture | null = null;
  let dstTexture: GPUTexture | null = null;
  let uniformBuffer: GPUBuffer | null = null;
  let readbackBuffer: GPUBuffer | null = null;
  let readbackMapped = false;

  try {
    // Create source texture. `writeTexture` accepts the tightly packed upload
    // stride; the 256-byte alignment rule applies to the copy command below.
    srcTexture = device.createTexture({
      label: `varve:color-halftone:source:${w}x${h}`,
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture: srcTexture },
      new Uint8Array(data.data),
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    );

    // Create destination storage texture.
    dstTexture = device.createTexture({
      label: `varve:color-halftone:destination:${w}x${h}`,
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    // Create uniform buffer.
    uniformBuffer = device.createBuffer({
      label: 'varve:color-halftone:params',
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformData = new ArrayBuffer(UNIFORM_SIZE);
    fillUniformBuffer(new DataView(uniformData), params, channelAngles, inkColorNorm);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Bind group.
    const bindGroup = device.createBindGroup({
      layout: gpuBindGroupLayout!,
      entries: [
        { binding: 0, resource: srcTexture.createView() },
        { binding: 1, resource: dstTexture.createView() },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    // Readback buffer. Texture-to-buffer copies require padded rows, including
    // narrow images whose logical RGBA row is less than 256 bytes.
    const readbackLayout = rgba8TextureReadbackLayout(w, h);
    readbackBuffer = device.createBuffer({
      label: `varve:color-halftone:readback:${w}x${h}`,
      size: readbackLayout.bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Encode and submit.
    const encoder = device.createCommandEncoder({ label: 'varve:color-halftone:dispatch' });
    const pass = encoder.beginComputePass({ label: 'color-halftone' });
    pass.setPipeline(gpuPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16));
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: dstTexture },
      {
        buffer: readbackBuffer,
        bytesPerRow: readbackLayout.bytesPerRow,
        rowsPerImage: h,
      },
      { width: w, height: h },
    );
    device.queue.submit([encoder.finish()]);

    // Read back and remove the padded rows before exposing pixels to Canvas2D.
    await device.queue.onSubmittedWorkDone();
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    readbackMapped = true;
    const resultData = new Uint8Array(readbackBuffer.getMappedRange());
    data.data.set(unpackRgba8TextureReadback(resultData, w, h));
    return data;
  } finally {
    if (readbackMapped) readbackBuffer?.unmap();
    srcTexture?.destroy();
    dstTexture?.destroy();
    uniformBuffer?.destroy();
    readbackBuffer?.destroy();
  }
}
