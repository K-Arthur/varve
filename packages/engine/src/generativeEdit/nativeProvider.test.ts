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

import { nativeGenerativeProvider } from './nativeProvider';
import { GenerativeEditError } from './types';

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
        output_w: 8,
        output_h: 6,
      }),
    });
    expect(invoke.mock.calls[0]?.[1]?.options).not.toHaveProperty('model_path');
    expect(result.executionProvider).toBe('native-cpu');
  });

  it('preserves typed native setup errors', async () => {
    invoke.mockRejectedValue(new GenerativeEditError('missing-model', 'Model is not ready.'));

    await expect(nativeGenerativeProvider.infer(request())).rejects.toMatchObject({
      code: 'missing-model',
      message: 'Model is not ready.',
    });
  });

  it('cancels the native request and rejects without accepting a late result', async () => {
    const controller = new AbortController();
    const pending = new Promise<never>(() => undefined);
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
  });
});
