/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decodeImageBytesToImageData, invoke } = vi.hoisted(() => ({
  decodeImageBytesToImageData: vi.fn(async () => new ImageData(8, 6)),
  invoke: vi.fn(),
}));

vi.mock('@varve/platform', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

vi.mock('../upscaleProviders/pngDecode', () => ({ decodeImageBytesToImageData }));

import { getInferenceAdmission } from '../inference/admission';
import { nativeGenerativeProvider } from './nativeProvider';
import { GenerativeEditError } from './types';

function getInferenceAdmissionSnapshot() {
  return getInferenceAdmission().getSnapshot();
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'replace' as const,
    imageData: new ImageData(8, 6),
    mask: new Uint8Array(8 * 6).fill(255),
    maskWidth: 8,
    maskHeight: 6,
    quality: 'quality' as const,
    modelHandle: 'varve-diffusion-inpainting',
    prompt: 'a red ceramic apple',
    negativePrompt: 'text, watermark',
    seed: 417,
    strength: 0.85,
    steps: 28,
    guidanceScale: 6.5,
    outputWidth: 8,
    outputHeight: 6,
    ...overrides,
  };
}

describe('nativeGenerativeProvider', () => {
  beforeEach(() => {
    invoke.mockReset();
    decodeImageBytesToImageData.mockClear();
  });

  it('forwards prompt settings and mode without exposing a filesystem model path', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 8,
      height: 6,
      execution_backend: 'native-cpu',
      processing_time_ms: 42,
      warnings: [],
    });

    const result = await nativeGenerativeProvider.infer(request());

    expect(invoke).toHaveBeenCalledWith('generative_edit', {
      options: expect.objectContaining({
        model_handle: 'varve-diffusion-inpainting',
        mode: 'replace',
        prompt: 'a red ceramic apple',
        negative_prompt: 'text, watermark',
        seed: 417,
        strength: 0.85,
        steps: 28,
        guidance_scale: 6.5,
        image_guidance_scale: 1,
        output_w: 8,
        output_h: 6,
      }),
    });
    expect(invoke.mock.calls[0]?.[1]?.options).not.toHaveProperty('model_path');
    expect(result.executionProvider).toBe('native-cpu');
  });

  it('forwards an explicit image-conditioning guidance setting', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 8,
      height: 6,
      execution_backend: 'native-cpu',
      processing_time_ms: 42,
      warnings: [],
    });

    await nativeGenerativeProvider.infer(request({ imageGuidanceScale: 2.25 }));

    expect(invoke.mock.calls[0]?.[1]?.options).toEqual(
      expect.objectContaining({ image_guidance_scale: 2.25 }),
    );
  });

  it('preserves typed native setup errors', async () => {
    invoke.mockRejectedValue(new GenerativeEditError('missing-model', 'Model is not ready.'));

    await expect(nativeGenerativeProvider.infer(request())).rejects.toMatchObject({
      code: 'missing-model',
      message: 'Model is not ready.',
    });
  });

  it('classifies an unqualified native model as a setup failure', async () => {
    invoke.mockRejectedValue(
      new Error('The local diffusion model has not passed inpainting qualification'),
    );

    await expect(nativeGenerativeProvider.infer(request())).rejects.toMatchObject({
      code: 'missing-model',
      message: expect.stringContaining('qualification'),
    });
  });

  it.each([
    ['The diffusion helper supports Fill, Replace, and Expand only', 'unsupported-mode'],
    ['A prompt is required for prompt-capable generation', 'prompt-unavailable'],
    ['Generation mask dimensions must match the output working frame', 'invalid-mask'],
    ['Generation source image buffer does not match its declared dimensions', 'invalid-image'],
    ['The packaged local diffusion helper is unavailable', 'unsupported-runtime'],
    ['The generation request does not fit this device memory budget', 'insufficient-memory'],
    ['Vulkan device lost while running the diffusion helper', 'device-loss'],
    ['The source changed while generation was running', 'stale'],
  ] as const)('classifies native failure %s as %s', async (message, code) => {
    invoke.mockRejectedValue(new Error(message));

    await expect(nativeGenerativeProvider.infer(request())).rejects.toMatchObject({
      code,
      message,
    });
  });

  it('rejects a response whose geometry does not match the requested frame', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 7,
      height: 6,
      execution_backend: 'native-cpu',
      processing_time_ms: 42,
      warnings: [],
    });

    await expect(nativeGenerativeProvider.infer(request())).rejects.toMatchObject({
      code: 'runtime-failure',
      message: expect.stringContaining('does not match the requested'),
    });
    expect(decodeImageBytesToImageData).not.toHaveBeenCalled();
  });

  it('rejects response metadata that cannot support honest provenance', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 8,
      height: 6,
      execution_backend: '',
      processing_time_ms: -1,
      warnings: [42],
    });

    await expect(nativeGenerativeProvider.infer(request())).rejects.toMatchObject({
      code: 'runtime-failure',
      message: expect.stringMatching(/execution backend|processing time|warnings/),
    });
    expect(decodeImageBytesToImageData).not.toHaveBeenCalled();
  });

  it('cancels the native request and rejects without accepting a late result', async () => {
    const controller = new AbortController();
    let resolveNative!: (response: {
      png_base64: string;
      width: number;
      height: number;
      execution_backend: string;
      processing_time_ms: number;
      warnings: string[];
    }) => void;
    const pending = new Promise<{
      png_base64: string;
      width: number;
      height: number;
      execution_backend: string;
      processing_time_ms: number;
      warnings: string[];
    }>((resolve) => {
      resolveNative = resolve;
    });
    invoke.mockImplementation((command: string) => {
      if (command === 'generative_edit') return pending;
      return Promise.resolve();
    });

    const generation = nativeGenerativeProvider.infer({
      ...request(),
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('generative_edit', expect.anything()),
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cancel_generative_edit', expect.anything()),
    );
    await expect(generation).rejects.toMatchObject({ code: 'cancelled' });
    resolveNative({
      png_base64: btoa('png'),
      width: 8,
      height: 6,
      execution_backend: 'native-cpu',
      processing_time_ms: 42,
      warnings: [],
    });
  });

  it('rejects when cancellation arrives while the native output is decoding', async () => {
    const controller = new AbortController();
    let resolveDecode!: (imageData: ImageData) => void;
    decodeImageBytesToImageData.mockImplementationOnce(
      () =>
        new Promise<ImageData>((resolve) => {
          resolveDecode = resolve;
        }),
    );
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 8,
      height: 6,
      execution_backend: 'native-cpu',
      processing_time_ms: 42,
      warnings: [],
    });

    const generation = nativeGenerativeProvider.infer({
      ...request(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(decodeImageBytesToImageData).toHaveBeenCalled());

    controller.abort();
    resolveDecode(new ImageData(8, 6));

    await expect(generation).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('keeps the shared heavy-inference lease until cancelled native work settles', async () => {
    const controller = new AbortController();
    let resolveFirst!: (response: {
      png_base64: string;
      width: number;
      height: number;
      execution_backend: string;
      processing_time_ms: number;
      warnings: string[];
    }) => void;
    const firstNative = new Promise<{
      png_base64: string;
      width: number;
      height: number;
      execution_backend: string;
      processing_time_ms: number;
      warnings: string[];
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const validResponse = {
      png_base64: btoa('png'),
      width: 8,
      height: 6,
      execution_backend: 'native-cpu',
      processing_time_ms: 42,
      warnings: [],
    };
    let generationCalls = 0;
    invoke.mockImplementation((command: string) => {
      if (command === 'cancel_generative_edit') return Promise.resolve();
      generationCalls += 1;
      return generationCalls === 1 ? firstNative : Promise.resolve(validResponse);
    });

    const firstGeneration = nativeGenerativeProvider.infer({
      ...request(),
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('generative_edit', expect.anything()),
    );
    const secondGeneration = nativeGenerativeProvider.infer(request({ seed: 418 }));
    await vi.waitFor(() =>
      expect(getInferenceAdmissionSnapshot()).toMatchObject({ active: 1, pending: 1 }),
    );

    controller.abort();
    await expect(firstGeneration).rejects.toMatchObject({ code: 'cancelled' });
    expect(getInferenceAdmissionSnapshot()).toMatchObject({ active: 1, pending: 1 });

    resolveFirst(validResponse);
    await expect(secondGeneration).resolves.toMatchObject({
      executionProvider: 'native-cpu',
    });
    expect(getInferenceAdmissionSnapshot()).toMatchObject({ active: 0, pending: 0 });
  });
});
