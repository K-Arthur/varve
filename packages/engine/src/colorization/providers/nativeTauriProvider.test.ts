import { describe, expect, it } from 'vitest';
import { nativeScunetInfer, nativeTauriColorizationProvider } from './nativeTauriProvider';

describe('native Tauri colorization availability', () => {
  it('does not advertise an incomplete inference implementation', async () => {
    expect(await nativeTauriColorizationProvider.isAvailable()).toBe(false);
  });

  it('rejects direct inference without transferring image data', async () => {
    const pixels = new Uint8ClampedArray(4);
    const imageData = { data: pixels, width: 1, height: 1 } as ImageData;

    await expect(nativeScunetInfer(imageData, '/models/scunet.onnx', 0.5)).rejects.toThrow(
      /not implemented/i,
    );
  });
});
