/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decodeImageBytesToImageData, invoke } = vi.hoisted(() => ({
  decodeImageBytesToImageData: vi.fn(async () => new ImageData(24, 16)),
  invoke: vi.fn(),
}));

vi.mock('@varve/platform', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

vi.mock('../upscaleProviders/pngDecode', () => ({ decodeImageBytesToImageData }));

import { getInferenceAdmission } from '../inference/admission';
import { nativeLaMaProvider } from './nativeProvider';

describe('nativeLaMaProvider', () => {
  beforeEach(() => {
    invoke.mockReset();
    decodeImageBytesToImageData.mockClear();
  });

  it('sends the bounded RGBA image and mask to the native command', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa(String.fromCharCode(137, 80, 78, 71)),
      width: 24,
      height: 16,
      model_id: 'lama-inpainting',
      execution_backend: 'ort-native',
      processing_time_ms: 42,
      warnings: [],
    });

    const image = new ImageData(24, 16);
    const mask = new Uint8Array(image.width * image.height).fill(255);
    const result = await nativeLaMaProvider.infer(image, mask);

    expect(invoke).toHaveBeenCalledWith('content_aware_fill', {
      options: expect.objectContaining({
        request_id: expect.any(String),
        image_data: Array.from(image.data),
        image_w: 24,
        image_h: 16,
        mask: Array.from(mask),
        mask_w: 24,
        mask_h: 16,
        preview_max_dimension: 2048,
      }),
    });
    expect(decodeImageBytesToImageData).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]));
    expect(result.executionProvider).toBe('native');
    expect(result.processingTimeMs).toBe(42);
  });

  it('rejects a native response with mismatched decoded dimensions', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 24,
      height: 16,
      model_id: 'lama-inpainting',
      execution_backend: 'ort-native',
      processing_time_ms: 1,
      warnings: [],
    });
    decodeImageBytesToImageData.mockResolvedValueOnce(new ImageData(12, 8));

    await expect(
      nativeLaMaProvider.infer(new ImageData(24, 16), new Uint8Array(24 * 16)),
    ).rejects.toThrow('do not match response');
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
      width: 24,
      height: 16,
      model_id: 'lama-inpainting',
      execution_backend: 'ort-native',
      processing_time_ms: 1,
      warnings: [],
    });

    const inference = nativeLaMaProvider.infer(
      new ImageData(24, 16),
      new Uint8Array(24 * 16),
      controller.signal,
    );
    await vi.waitFor(() => expect(decodeImageBytesToImageData).toHaveBeenCalled());

    controller.abort();
    resolveDecode(new ImageData(24, 16));

    await expect(inference).rejects.toThrow('cancelled');
  });

  it('rejects native metadata that cannot support honest provenance', async () => {
    invoke.mockResolvedValue({
      png_base64: btoa('png'),
      width: 24,
      height: 16,
      model_id: '',
      execution_backend: 'ort-native',
      processing_time_ms: 1,
      warnings: [],
    });

    await expect(
      nativeLaMaProvider.infer(new ImageData(24, 16), new Uint8Array(24 * 16)),
    ).rejects.toThrow('no model id');
    expect(decodeImageBytesToImageData).not.toHaveBeenCalled();
  });

  it('cancels the native request and does not await a late helper response', async () => {
    const controller = new AbortController();
    let resolvePending!: (response: {
      png_base64: string;
      width: number;
      height: number;
      model_id: string;
      execution_backend: string;
      processing_time_ms: number;
      warnings: string[];
    }) => void;
    const pending = new Promise<{
      png_base64: string;
      width: number;
      height: number;
      model_id: string;
      execution_backend: string;
      processing_time_ms: number;
      warnings: string[];
    }>((resolve) => {
      resolvePending = resolve;
    });
    invoke.mockImplementation((command: string) => {
      if (command === 'content_aware_fill') return pending;
      return Promise.resolve();
    });

    const inference = nativeLaMaProvider.infer(
      new ImageData(24, 16),
      new Uint8Array(24 * 16),
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('content_aware_fill', expect.anything()),
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cancel_content_aware_fill', expect.anything()),
    );
    await expect(inference).rejects.toThrow('cancelled');

    expect(getInferenceAdmission().getSnapshot()).toMatchObject({ active: 1, pending: 0 });
    resolvePending({
      png_base64: btoa('png'),
      width: 24,
      height: 16,
      model_id: 'lama-inpainting',
      execution_backend: 'ort-native',
      processing_time_ms: 1,
      warnings: [],
    });
    await vi.waitFor(() =>
      expect(getInferenceAdmission().getSnapshot()).toMatchObject({ active: 0, pending: 0 }),
    );
  });
});
