import { describe, expect, it } from 'vitest';
import { rgba8TextureReadbackLayout, unpackRgba8TextureReadback } from './colorHalftoneGpu';

describe('RGBA8 WebGPU readback layout', () => {
  it('pads narrow rows and allocates the complete mapped buffer', () => {
    expect(rgba8TextureReadbackLayout(48, 32)).toEqual({
      rowBytes: 192,
      bytesPerRow: 256,
      bufferSize: 8192,
    });
    expect(rgba8TextureReadbackLayout(64, 3).bytesPerRow).toBe(256);
    expect(rgba8TextureReadbackLayout(65, 3)).toMatchObject({
      rowBytes: 260,
      bytesPerRow: 512,
      bufferSize: 1536,
    });
  });

  it('unpacks every padded row into the tight ImageData layout', () => {
    const layout = rgba8TextureReadbackLayout(3, 2);
    const mapped = new Uint8Array(layout.bufferSize);
    mapped.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 0);
    mapped.set([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], layout.bytesPerRow);

    expect(unpackRgba8TextureReadback(mapped, 3, 2)).toEqual(
      new Uint8ClampedArray([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
      ]),
    );
  });
});
