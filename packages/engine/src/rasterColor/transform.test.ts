import { convertEncodedRgb } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { allocatePixelBuffer, float32ToHalfFloat, halfFloatToFloat32 } from './pixelBuffer';
import { createAnalyticRgbTransform, transformDescriptor } from './transform';

const sourceEncoding = {
  model: 'rgb' as const,
  primaries: 'srgb' as const,
  transfer: 'srgb' as const,
  provenance: 'named' as const,
};

const targetEncoding = {
  model: 'rgb' as const,
  primaries: 'display-p3' as const,
  transfer: 'srgb' as const,
  provenance: 'named' as const,
};

function makeBuffer(
  format: 'rgba8' | 'rgba16' | 'rgba16f' | 'rgba32f',
  alphaMode: 'straight' | 'premultiplied' = 'straight',
) {
  return allocatePixelBuffer({
    ...transformDescriptor(1, 1, format, sourceEncoding),
    alphaMode,
  });
}

describe('typed raster colour transforms', () => {
  it('advertises and transforms every supported typed format', async () => {
    const transform = createAnalyticRgbTransform(sourceEncoding, targetEncoding);
    expect(transform).not.toBeNull();
    expect(transform!.supports('rgba8')).toBe(true);
    expect(transform!.supports('rgba16')).toBe(true);
    expect(transform!.supports('rgba16f')).toBe(true);
    expect(transform!.supports('rgba32f')).toBe(true);
    expect(transform!.supports('cmyka8')).toBe(false);

    const cases = [
      { format: 'rgba8' as const, values: [32, 64, 128, 255] },
      { format: 'rgba16' as const, values: [8192, 16384, 32768, 65535] },
      { format: 'rgba16f' as const, values: [0.125, 0.25, 0.5, 1] },
      { format: 'rgba32f' as const, values: [0.125, 0.25, 0.5, 1] },
    ];

    for (const { format, values } of cases) {
      const buffer = makeBuffer(format);
      if (format === 'rgba8') buffer.data.set(values);
      else if (format === 'rgba16') buffer.data.set(values);
      else if (format === 'rgba16f') {
        buffer.data.set(values.map(float32ToHalfFloat));
      } else buffer.data.set(values);
      await transform!.convertPixelBuffer(buffer);
      expect(buffer.descriptor.colorEncoding).toEqual(targetEncoding);
      expect(buffer.descriptor.alphaMode).toBe('straight');
      expect(readRgba(buffer.data, format)[3]).toBeCloseTo(1, 5);
    }
  });

  it('preserves fractional high-precision channels instead of reducing to RGBA8', async () => {
    const transform = createAnalyticRgbTransform(sourceEncoding, targetEncoding)!;
    const floatBuffer = makeBuffer('rgba32f');
    floatBuffer.data.set([0.1234, 0.2345, 0.3456, 1]);
    await transform.convertPixelBuffer(floatBuffer);
    const rgba = readRgba(floatBuffer.data, 'rgba32f');
    expect(rgba[0]).not.toBe(Math.round(rgba[0] * 255) / 255);
    expect(rgba[1]).toBeGreaterThan(0);
    expect(rgba[2]).toBeGreaterThan(0);
  });

  it('unpremultiplies before conversion and restores premultiplied alpha', async () => {
    const transform = createAnalyticRgbTransform(sourceEncoding, targetEncoding)!;
    const buffer = makeBuffer('rgba32f', 'premultiplied');
    const straight = [0.2, 0.4, 0.6] as const;
    const alpha = 0.5;
    buffer.data.set([straight[0] * alpha, straight[1] * alpha, straight[2] * alpha, alpha]);

    await transform.convertPixelBuffer(buffer);
    const expected = convertEncodedRgb(
      { primaries: 'srgb', transfer: 'srgb' },
      { primaries: 'display-p3', transfer: 'srgb' },
      straight,
    )!;
    const rgba = readRgba(buffer.data, 'rgba32f');
    expect(rgba[0]).toBeCloseTo(expected[0] * alpha, 6);
    expect(rgba[1]).toBeCloseTo(expected[1] * alpha, 6);
    expect(rgba[2]).toBeCloseTo(expected[2] * alpha, 6);
    expect(rgba[3]).toBe(alpha);
  });

  it('checks cancellation between tiles and leaves metadata unchanged on abort', async () => {
    const transform = createAnalyticRgbTransform(sourceEncoding, targetEncoding)!;
    const buffer = allocatePixelBuffer({
      width: 1,
      height: 300,
      format: 'rgba32f',
      colorEncoding: sourceEncoding,
      alphaMode: 'straight',
    });
    buffer.data.fill(1);
    const controller = new AbortController();
    controller.abort();
    await expect(transform.convertPixelBuffer(buffer, controller.signal)).rejects.toThrow(
      'aborted',
    );
    expect(buffer.descriptor.colorEncoding).toEqual(sourceEncoding);
  });
});

function readRgba(
  data: Uint8Array | Uint16Array | Float32Array,
  format: 'rgba8' | 'rgba16' | 'rgba16f' | 'rgba32f',
): [number, number, number, number] {
  if (format === 'rgba8')
    return Array.from(data, (value) => value / 255) as [number, number, number, number];
  if (format === 'rgba16')
    return Array.from(data, (value) => value / 65535) as [number, number, number, number];
  if (format === 'rgba16f') {
    return Array.from(data, (value) => halfFloatToFloat32(value)) as [
      number,
      number,
      number,
      number,
    ];
  }
  return Array.from(data) as [number, number, number, number];
}
