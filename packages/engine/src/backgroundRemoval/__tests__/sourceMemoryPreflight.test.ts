// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, mockDownscale, mockRuntime } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockDownscale: vi.fn(),
  mockRuntime: vi.fn(),
}));

vi.mock('../../inference/core/RuntimeCapabilities', () => ({
  getRuntimeCapabilities: mockRuntime,
}));

vi.mock('../providers/dispatch', () => ({
  dispatchBackgroundRemoval: mockDispatch,
}));

vi.mock('../previewDownscale', () => ({
  downscaleImageData: mockDownscale,
}));

describe('background-removal source memory preflight', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    mockDownscale.mockReset();
  });

  it('refuses a large real-image-shaped source before temporary downscale allocation', async () => {
    mockRuntime.mockResolvedValue({
      isTauri: false,
      wasmSafePeakBytes: 400_000_000,
    });

    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    const previousDeviceMemory = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
    Object.defineProperty(navigatorWithMemory, 'deviceMemory', {
      configurable: true,
      value: 2,
    });

    try {
      const { removeBackground } = await import('../index');
      const imageData = {
        width: 5171,
        height: 6402,
        data: new Uint8ClampedArray(0),
      } as unknown as ImageData;

      await expect(removeBackground(imageData, { method: 'ai-balanced' })).rejects.toThrow(
        /safe inference budget/i,
      );
      expect(mockDownscale).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    } finally {
      if (previousDeviceMemory) {
        Object.defineProperty(navigator, 'deviceMemory', previousDeviceMemory);
      } else {
        Reflect.deleteProperty(navigatorWithMemory, 'deviceMemory');
      }
    }
  });

  it('keeps native desktop preparation under the native command authority', async () => {
    mockRuntime.mockResolvedValue({
      isTauri: true,
      wasmSafePeakBytes: 400_000_000,
    });

    const { removeBackground } = await import('../index');
    const imageData = {
      width: 4096,
      height: 4096,
      data: new Uint8ClampedArray(0),
    } as unknown as ImageData;

    mockDownscale.mockReturnValue(imageData);
    mockDispatch.mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,mask',
      confidence: 1,
      method: 'ai-balanced',
      processingTimeMs: 1,
      width: imageData.width,
      height: imageData.height,
      rawMask: new Uint8Array(imageData.width * imageData.height),
    });

    await removeBackground(imageData, { method: 'ai-balanced' });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('uses the conservative safe peak when the browser omits its memory hint', async () => {
    mockRuntime.mockResolvedValue({
      isTauri: false,
      wasmSafePeakBytes: 400_000_000,
    });

    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    const previousDeviceMemory = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
    Reflect.deleteProperty(navigatorWithMemory, 'deviceMemory');

    try {
      const { removeBackground } = await import('../index');
      const imageData = {
        width: 5171,
        height: 6402,
        data: new Uint8ClampedArray(0),
      } as unknown as ImageData;

      await expect(removeBackground(imageData, { method: 'ai-balanced' })).rejects.toThrow(
        /safe inference budget/i,
      );
      expect(mockDownscale).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    } finally {
      if (previousDeviceMemory) {
        Object.defineProperty(navigator, 'deviceMemory', previousDeviceMemory);
      } else {
        Reflect.deleteProperty(navigatorWithMemory, 'deviceMemory');
      }
    }
  });
});
