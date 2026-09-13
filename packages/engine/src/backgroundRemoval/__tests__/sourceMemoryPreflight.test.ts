// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, mockDownscale, mockNativePreflight, mockNativeStatus, mockRuntime } =
  vi.hoisted(() => ({
    mockDispatch: vi.fn(),
    mockDownscale: vi.fn(),
    mockNativePreflight: vi.fn(),
    mockNativeStatus: vi.fn(),
    mockRuntime: vi.fn(),
  }));

vi.mock('../../inference/core/RuntimeCapabilities', () => ({
  getRuntimeCapabilities: mockRuntime,
}));

vi.mock('../providers/dispatch', () => ({
  dispatchBackgroundRemoval: mockDispatch,
}));

vi.mock('../providers/tauriProvider', () => ({
  getNativeBackgroundRemovalModelStatus: mockNativeStatus,
  preflightNativeBackgroundRemoval: mockNativePreflight,
}));

vi.mock('../previewDownscale', () => ({
  downscaleImageData: mockDownscale,
}));

describe('background-removal source memory preflight', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    mockDownscale.mockReset();
    mockNativePreflight.mockReset().mockResolvedValue(undefined);
    mockNativeStatus.mockReset().mockResolvedValue(null);
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
    mockNativeStatus.mockResolvedValue({ runtimeReady: true, installed: true });

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
    expect(mockNativePreflight).toHaveBeenCalledWith('isnet-general-use', 4096, 4096);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('refuses before downscale when a native model does not fit the desktop budget', async () => {
    mockRuntime.mockResolvedValue({
      isTauri: true,
      wasmSafePeakBytes: 400_000_000,
    });
    mockNativeStatus.mockResolvedValue({ runtimeReady: true, installed: true });
    mockNativePreflight.mockRejectedValue(
      new Error(
        'Native background removal needs about 7424 MiB, but only 1536 MiB is currently available on this aarch64 device',
      ),
    );

    const { removeBackground } = await import('../index');
    const imageData = {
      width: 5171,
      height: 6402,
      data: new Uint8ClampedArray(0),
    } as unknown as ImageData;

    await expect(removeBackground(imageData, { method: 'ai-quality' })).rejects.toThrow(
      /aarch64 device/i,
    );
    expect(mockDownscale).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('uses the browser safe peak when a desktop has no native model', async () => {
    mockRuntime.mockResolvedValue({
      isTauri: true,
      wasmSafePeakBytes: 400_000_000,
    });
    mockNativeStatus.mockResolvedValue({ runtimeReady: false, installed: false });

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
