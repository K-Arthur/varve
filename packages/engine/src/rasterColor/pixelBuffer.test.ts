import { describe, expect, it } from 'vitest';
import {
  allocatePixelBuffer,
  convertPixelBufferFormat,
  pixelBufferBytes,
  pixelBufferChannelCount,
} from './pixelBuffer';

const cmykEncoding = {
  model: 'cmyk' as const,
  bitDepth: 8 as const,
  alphaMode: 'straight' as const,
  profileId: 'fogra39',
  provenance: 'embedded-icc' as const,
};

describe('CMYKA pixel-buffer contract', () => {
  it('allocates five interleaved channels for CMYK plus alpha', () => {
    const buffer = allocatePixelBuffer({
      width: 2,
      height: 1,
      format: 'cmyka8',
      colorEncoding: cmykEncoding,
      alphaMode: 'straight',
    });
    expect(buffer.data).toBeInstanceOf(Uint8Array);
    expect(buffer.data.length).toBe(10);
    expect(pixelBufferChannelCount('cmyka8')).toBe(5);
    expect(pixelBufferBytes(2, 1, 'cmyka8')).toBe(10);
  });

  it('preserves all CMYKA channels across an explicit precision conversion', () => {
    const source = allocatePixelBuffer({
      width: 1,
      height: 1,
      format: 'cmyka8',
      colorEncoding: cmykEncoding,
      alphaMode: 'straight',
    });
    source.data.set([0, 64, 128, 255, 128]);
    const target = convertPixelBufferFormat(source, 'cmyka16');
    expect(target.descriptor.format).toBe('cmyka16');
    expect(Array.from(target.data)).toEqual([0, 16448, 32896, 65535, 32896]);
  });

  it('rejects the old ambiguous RGBA-plus-CMYK representation', () => {
    expect(() =>
      allocatePixelBuffer({
        width: 1,
        height: 1,
        format: 'rgba8',
        colorEncoding: cmykEncoding,
        alphaMode: 'straight',
      }),
    ).toThrow(/CMYKA/);
  });

  it('rejects a five-channel format that claims RGB semantics', () => {
    expect(() =>
      allocatePixelBuffer({
        width: 1,
        height: 1,
        format: 'cmyka8',
        colorEncoding: {
          model: 'rgb',
          primaries: 'srgb',
          transfer: 'srgb',
          provenance: 'named',
        },
        alphaMode: 'straight',
      }),
    ).toThrow(/CMYK color encoding/);
  });

  it('does not permit a storage conversion to change RGB into CMYK semantics', () => {
    const rgb = allocatePixelBuffer({
      width: 1,
      height: 1,
      format: 'rgba8',
      colorEncoding: {
        model: 'rgb',
        primaries: 'srgb',
        transfer: 'srgb',
        provenance: 'named',
      },
      alphaMode: 'straight',
    });
    expect(() => convertPixelBufferFormat(rgb, 'cmyka8')).toThrow(/channel model/);
  });
});
