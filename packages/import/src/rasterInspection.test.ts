import { describe, expect, it } from 'vitest';
import { inspectRasterBytes } from './rasterInspection';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  for (let i = 0; i < 4; i++) {
    bytes[16 + i] = (width >>> (24 - i * 8)) & 0xff;
    bytes[20 + i] = (height >>> (24 - i * 8)) & 0xff;
  }
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 33);
  return bytes;
}

function twoFrameGif(): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1,
    0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0, 0x3b,
  ]);
}

describe('inspectRasterBytes', () => {
  it('returns sniffed MIME and checked dimensions', () => {
    expect(inspectRasterBytes(pngHeader(12, 8))).toMatchObject({
      mimeType: 'image/png',
      width: 12,
      height: 8,
      animation: 'static',
    });
  });

  it('checks encoded, dimension, and decoded-pixel budgets before decode', () => {
    expect(() => inspectRasterBytes(pngHeader(12, 8), { maxEncodedBytes: 8 })).toThrow(
      /encoded size limit/i,
    );
    expect(() => inspectRasterBytes(pngHeader(12, 8), { maxDimension: 10 })).toThrow(/dimension/i);
    expect(() => inspectRasterBytes(pngHeader(12, 8), { maxPixels: 95 })).toThrow(/pixel budget/i);
  });

  it('detects animated GIFs from container content with metadata', () => {
    const inspection = inspectRasterBytes(twoFrameGif());
    expect(inspection.animation).toBe('animated');
    expect(inspection.animated).toMatchObject({
      kind: 'gif',
      frameCount: 2,
      width: 1,
      height: 1,
      loopCount: 1,
    });
    expect(inspection.animated?.frames).toHaveLength(2);
  });

  it('rejects corrupt animated containers like any corrupt image', () => {
    // GIF bytes whose image descriptor is truncated
    const corrupt = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0,
    ]);
    expect(() => inspectRasterBytes(corrupt)).toThrow();
  });

  it('treats single-frame GIFs as static', () => {
    const single = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2,
      1, 0, 0, 0x3b,
    ]);
    expect(inspectRasterBytes(single)).toMatchObject({ animation: 'static' });
  });
});
