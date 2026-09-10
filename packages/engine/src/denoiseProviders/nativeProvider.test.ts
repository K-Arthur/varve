import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decodeImageBytesToImageData, encodeImageDataToPngBytes, invoke } = vi.hoisted(() => ({
  decodeImageBytesToImageData: vi.fn(async () => new ImageData(12, 8)),
  encodeImageDataToPngBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  invoke: vi.fn(),
}));

vi.mock('@varve/platform', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}));

vi.mock('../upscaleProviders/pngDecode', () => ({
  decodeImageBytesToImageData,
  encodeImageDataToPngBytes,
}));

import { nativeRestorationProvider } from '../restorationProviders/nativeProvider';

describe('nativeRestorationProvider', () => {
  beforeEach(() => {
    invoke.mockReset();
    decodeImageBytesToImageData.mockClear();
    encodeImageDataToPngBytes.mockClear();
  });

  it('decodes the camel-case native response before releasing image resources', async () => {
    invoke.mockResolvedValue({
      pngBase64: btoa(String.fromCharCode(137, 80, 78, 71)),
      width: 12,
      height: 8,
      processingTimeMs: 27,
    });

    const result = await nativeRestorationProvider.restore({
      tensor: new Float32Array(12 * 8 * 3),
      width: 12,
      height: 8,
      targetWidth: 12,
      targetHeight: 8,
      originalData: new Uint8ClampedArray(12 * 8 * 4),
      alphaData: null,
      strength: 0.3,
      modelId: 'scunet',
    });

    expect(invoke).toHaveBeenCalledWith('denoise_image', {
      imageData: [1, 2, 3],
      options: { modelId: 'scunet', strength: 0.3 },
    });
    expect(decodeImageBytesToImageData).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]));
    expect(result.imageData.width).toBe(12);
    expect(result.imageData.height).toBe(8);
    expect(result.processingTimeMs).toBe(27);
  });

  it('routes the model id through to the native command for task dispatch', async () => {
    invoke.mockResolvedValue({
      pngBase64: btoa(String.fromCharCode(137, 80, 78, 71)),
      width: 12,
      height: 8,
      processingTimeMs: 5,
    });

    await nativeRestorationProvider.restore({
      tensor: new Float32Array(12 * 8 * 3),
      width: 12,
      height: 8,
      targetWidth: 12,
      targetHeight: 8,
      originalData: new Uint8ClampedArray(12 * 8 * 4),
      alphaData: null,
      strength: 0.5,
      modelId: 'nafnet-deblur-gopro',
    });

    expect(invoke).toHaveBeenCalledWith('denoise_image', {
      imageData: [1, 2, 3],
      options: { modelId: 'nafnet-deblur-gopro', strength: 0.5 },
    });
  });
});
