import { describe, expect, it } from 'vitest';
import { planRasterConversion, type RasterConversionError } from './rasterConversion';

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

describe('raster conversion planning', () => {
  it('describes a lossless PNG conversion without requiring a matte', () => {
    const plan = planRasterConversion(pngHeader(12, 8), { outputFormat: 'png' });

    expect(plan).toMatchObject({
      inputFormat: 'png',
      outputFormat: 'png',
      width: 12,
      height: 8,
      requiresBackground: false,
      metadataPolicy: 'normalized-rgba8',
    });
    expect(plan.blockingIssues).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/ICC|metadata/i);
  });

  it('requires an explicit background when flattening a potentially transparent source to JPEG', () => {
    const withoutBackground = planRasterConversion(pngHeader(1, 1), { outputFormat: 'jpeg' });
    expect(withoutBackground.requiresBackground).toBe(true);
    expect(withoutBackground.blockingIssues).toEqual([
      'Choose a background color before converting to JPEG.',
    ]);

    const withBackground = planRasterConversion(pngHeader(1, 1), {
      outputFormat: 'jpeg',
      background: '#ffffff',
    });
    expect(withBackground.blockingIssues).toHaveLength(0);
    expect(withBackground.warnings.join(' ')).toMatch(/flattened/i);
  });

  it('discloses first-frame semantics for animated sources', () => {
    const plan = planRasterConversion(twoFrameGif(), { outputFormat: 'webp' });
    expect(plan.animation).toBe('animated');
    expect(plan.warnings.join(' ')).toMatch(/first decoded frame/i);
  });

  it('derives a locked output dimension and keeps source metadata visible', () => {
    const plan = planRasterConversion(pngHeader(12, 8), {
      outputFormat: 'png',
      width: 6,
    });

    expect(plan).toMatchObject({
      width: 12,
      height: 8,
      outputWidth: 6,
      outputHeight: 4,
      sourceColorModel: 'rgb',
      sourceBitDepth: '8',
      sourceProfile: 'not embedded',
      sourceOrientation: 'none',
    });
    expect(plan.warnings.join(' ')).toMatch(/resized from 12 x 8 to 6 x 4/i);
  });

  it('rejects unsupported output formats with a typed error', () => {
    expect(() =>
      planRasterConversion(pngHeader(1, 1), {
        outputFormat: 'tiff' as never,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RasterConversionError>>({ code: 'unsupported-output' }),
    );
  });
});
