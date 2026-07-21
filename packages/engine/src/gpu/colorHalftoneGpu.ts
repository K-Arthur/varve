/**
 * GPU-accelerated Color Halftone via WebGPU compute shader.
 *
 * Architecture:
 *   1. Source ImageData uploaded to GPU texture (rgba8unorm).
 *   2. WGSL compute shader screens each pixel per-channel.
 *   3. Result read back as ImageData for compositing.
 *   4. Falls through to CPU if WebGPU unavailable or image is small.
 */

import { initGpuCapability } from '../adjustmentPipeline';
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

// ── GPU pipeline management ────────────────────────────────────────────────

let gpuDevice: GPUDevice | null = null;
let gpuPipeline: GPUComputePipeline | null = null;
let gpuBindGroupLayout: GPUBindGroupLayout | null = null;

async function ensureGpuDevice(): Promise<GPUDevice | null> {
  if (gpuDevice) return gpuDevice;

  const capability = await initGpuCapability();
  if (capability.kind !== 'available') return null;

  gpuDevice = capability.device;

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

  gpuPipeline = gpuDevice.createComputePipeline({
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: 'main' },
  });

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
  if (gpuDevice) {
    gpuDevice.destroy();
    gpuDevice = null;
  }
}

const GPU_MIN_PIXELS = 32 * 32;

export async function applyColorHalftoneGpu(
  data: ImageData,
  params: ColorHalftoneParams,
): Promise<ImageData> {
  if (params.intensity === 0) return data;
  if (data.width * data.height < GPU_MIN_PIXELS) {
    return applyColorHalftone(data, params);
  }

  try {
    const device = await ensureGpuDevice();
    if (!device || !gpuPipeline || !gpuBindGroupLayout) {
      return applyColorHalftone(data, params);
    }

    return await dispatchGpu(device, data, params);
  } catch {
    resetGpuResources();
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

  // Create source texture
  const srcTexture = device.createTexture({
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

  // Create destination storage texture
  const dstTexture = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformBuffer = device.createBuffer({
    size: UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformData = new ArrayBuffer(UNIFORM_SIZE);
  fillUniformBuffer(new DataView(uniformData), params, channelAngles, inkColorNorm);
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Bind group
  const bindGroup = device.createBindGroup({
    layout: gpuBindGroupLayout!,
    entries: [
      { binding: 0, resource: srcTexture.createView() },
      { binding: 1, resource: dstTexture.createView() },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });

  // Readback buffer
  const readbackBuffer = device.createBuffer({
    size: w * h * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // Encode and submit
  const encoder = device.createCommandEncoder();
  {
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpuPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16));
    pass.end();
  }
  encoder.copyTextureToBuffer(
    { texture: dstTexture },
    { buffer: readbackBuffer, bytesPerRow: w * 4, rowsPerImage: h },
    { width: w, height: h },
  );
  device.queue.submit([encoder.finish()]);

  // Read back
  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const resultData = new Uint8Array(readbackBuffer.getMappedRange());
  data.data.set(resultData);
  readbackBuffer.unmap();

  // Cleanup
  srcTexture.destroy();
  dstTexture.destroy();
  uniformBuffer.destroy();
  readbackBuffer.destroy();

  return data;
}
