// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

const { createSession, configureOrtRuntime } = vi.hoisted(() => ({
  createSession: vi.fn(),
  configureOrtRuntime: vi.fn(),
}));

vi.mock('onnxruntime-web', () => ({
  InferenceSession: { create: createSession },
  Tensor: class {
    constructor(
      readonly type: string,
      readonly data: Float32Array,
      readonly dims: number[],
    ) {}
  },
}));

vi.mock('../backgroundRemoval/ortRuntimeAssets', () => ({ configureOrtRuntime }));
const { getBestOnnxProviders } = vi.hoisted(() => ({
  getBestOnnxProviders: vi.fn(async () => ['wasm']),
}));
vi.mock('../backgroundRemoval/environmentCapabilities', () => ({ getBestOnnxProviders }));

import {
  copyUpscaledTileCore,
  packRgbChw,
  upscaleWithRealEsrgan,
  upscaleWithRealEsrganWithMetadata,
} from './aiUpscale';

describe('Real-ESRGAN worker helpers', () => {
  it('uses the shared single-threaded ORT runtime configuration', async () => {
    getBestOnnxProviders.mockResolvedValue(['wasm']);
    createSession.mockResolvedValueOnce({
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn(async () => ({
        output: { data: new Float32Array(4 * 4 * 3).fill(0.5), dims: [1, 3, 4, 4] },
      })),
      release: vi.fn(async () => {}),
    });

    const result = await upscaleWithRealEsrgan(
      new ImageData(1, 1),
      '/models/realesr.onnx',
      () => false,
    );

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(configureOrtRuntime).toHaveBeenCalledTimes(1);
  });

  it('retries a model execution failure on WASM without overlapping sessions', async () => {
    getBestOnnxProviders.mockResolvedValue(['webgpu', 'wasm']);
    const gpuRelease = vi.fn(async () => {});
    const wasmRelease = vi.fn(async () => {});
    const gpuSession = {
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn().mockRejectedValue(new Error('WebGPU operator unsupported')),
      release: gpuRelease,
    };
    const wasmSession = {
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn(async () => ({
        output: { data: new Float32Array(4 * 4 * 3).fill(0.5), dims: [1, 3, 4, 4] },
      })),
      release: wasmRelease,
    };
    createSession.mockReset();
    createSession.mockResolvedValueOnce(gpuSession).mockResolvedValueOnce(wasmSession);

    const result = await upscaleWithRealEsrganWithMetadata(
      new ImageData(1, 1),
      '/models/realesr.onnx',
      () => false,
    );

    expect(result.executionProvider).toBe('wasm');
    expect(result.imageData.width).toBe(4);
    expect(gpuRelease).toHaveBeenCalledOnce();
    expect(wasmRelease).toHaveBeenCalledOnce();
    expect(createSession.mock.calls.map((call) => call[1])).toEqual([
      { executionProviders: ['webgpu'] },
      { executionProviders: ['wasm'] },
    ]);
  });

  it('packs RGB pixels as normalized NCHW planes', () => {
    const image = new ImageData(new Uint8ClampedArray([255, 128, 0, 17, 0, 64, 255, 255]), 2, 1);

    expect([...packRgbChw(image)]).toEqual([
      1,
      0,
      expect.closeTo(128 / 255, 6),
      expect.closeTo(64 / 255, 6),
      0,
      1,
    ]);
  });

  it('clears hidden RGB from fully transparent pixels before inference', () => {
    const image = new ImageData(new Uint8ClampedArray([255, 128, 64, 0]), 1, 1);
    expect([...packRgbChw(image)]).toEqual([0, 0, 0]);
  });

  it('copies only a tile core so padded overlaps cannot create seams', () => {
    const destination = new Uint8ClampedArray(4 * 4 * 4);
    const tileRgb = new Float32Array(6 * 6 * 3);
    const plane = 6 * 6;
    tileRgb.fill(0.25, 0, plane);
    tileRgb.fill(0.5, plane, plane * 2);
    tileRgb.fill(1, plane * 2);

    copyUpscaledTileCore({
      destination,
      destinationWidth: 4,
      tileRgb,
      tileWidth: 6,
      sourceCoreX: 1,
      sourceCoreY: 1,
      coreWidth: 4,
      coreHeight: 4,
      destinationX: 0,
      destinationY: 0,
    });

    expect([...destination.slice(0, 4)]).toEqual([64, 128, 255, 255]);
    expect(destination.every((value, index) => index % 4 === 3 || value > 0)).toBe(true);
  });
});
