/**
 * Export colour policy: real conversion of the rendered composite (never a
 * relabel), out-of-gamut preservation, and profile embedding gating.
 */
import { describe, expect, it } from 'vitest';
import {
  convertExportImageData,
  createExportTransform,
  exportProfileBytes,
  resolveExportEncoding,
} from './exportPolicy';
import { isWithinPixelBudget, pixelBufferBytes, rgba32fToRgba8 } from './pixelBuffer';
import { buildMatrixProfile, parseIccHeader } from './profiles';

function imageData1x1(r: number, g: number, b: number, a = 255): ImageData {
  return new ImageData(new Uint8ClampedArray([r, g, b, a]), 1, 1);
}

describe('convertExportImageData', () => {
  it('leaves sRGB policy untouched', async () => {
    const pixels = imageData1x1(10, 200, 30);
    const warnings = await convertExportImageData(pixels, { destination: 'srgb' });
    expect(warnings).toEqual([]);
    expect(Array.from(pixels.data)).toEqual([10, 200, 30, 255]);
  });

  it('converts sRGB green to Display P3 (engine-verified values)', async () => {
    const pixels = imageData1x1(0, 255, 0);
    const warnings = await convertExportImageData(pixels, { destination: 'display-p3' });
    expect(warnings.some((w) => w.includes('converted'))).toBe(true);
    // sRGB (0,1,0) → display-p3 (sRGB transfer) ≈ (0.458, 0.985, 0.298) —
    // consistent with the CSS Color 4 leaf goldens verified in @varve/shared.
    const [r, g, b] = Array.from(pixels.data);
    expect(r).toBeCloseTo(117, 1);
    expect(g).toBeCloseTo(251, 1);
    expect(b).toBeCloseTo(76, 1);
  });

  it('converts Adobe RGB to sRGB semantics (channel-preserving check)', async () => {
    // Destination Adobe RGB from an sRGB composite: a neutral grey stays
    // neutral; saturated sRGB red maps inside Adobe's wider gamut.
    const pixels = imageData1x1(255, 0, 0);
    await convertExportImageData(pixels, { destination: 'adobe-rgb' });
    const [r, g, b] = Array.from(pixels.data);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(40);
  });

  it('is cancellable mid-conversion', async () => {
    const pixels = imageData1x1(0, 255, 0);
    const controller = new AbortController();
    controller.abort();
    await expect(
      convertExportImageData(pixels, { destination: 'display-p3' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports an honest warning for unsupported destinations instead of converting', async () => {
    const pixels = imageData1x1(0, 255, 0);
    const warnings = await convertExportImageData(pixels, {
      destination: 'display-p3',
      transfer: 'pq',
    });
    expect(warnings.some((w) => w.includes('not analytically convertible'))).toBe(true);
    expect(Array.from(pixels.data)).toEqual([0, 255, 0, 255]);
  });
});

describe('createExportTransform', () => {
  it('builds a transform for convertible policies and null otherwise', () => {
    expect(createExportTransform({ destination: 'display-p3' })).not.toBeNull();
    expect(createExportTransform({})).not.toBeNull(); // identity srgb
    expect(createExportTransform({ destination: 'display-p3', transfer: 'hlg' })).toBeNull();
  });
});

describe('resolveExportEncoding + profile bytes', () => {
  it('defaults to sRGB when no destination is given', () => {
    expect(resolveExportEncoding().primaries).toBe('srgb');
    expect(resolveExportEncoding(undefined).provenance).toBe('user-assigned');
  });

  it('embeds an authored profile when requested', () => {
    const bytes = exportProfileBytes({ destination: 'display-p3', embedProfile: true });
    expect(bytes).not.toBeNull();
    if (!bytes) return;
    const header = parseIccHeader(bytes);
    expect(header.description).toBe('Varve Display P3');
  });

  it('returns null when embedProfile is not set', () => {
    expect(exportProfileBytes({ destination: 'display-p3' })).toBeNull();
    expect(exportProfileBytes(undefined)).toBeNull();
  });

  it('profile bytes are valid input for buildMatrixProfile round-trip', () => {
    const bytes = exportProfileBytes({ destination: 'pro-photo', embedProfile: true });
    expect(bytes).not.toBeNull();
    if (!bytes) return;
    expect(parseIccHeader(bytes).profileClass).toBe('mntr');
    const rebuilt = buildMatrixProfile('pro-photo');
    expect(bytes).toEqual(rebuilt);
  });
});

describe('pixelBuffer accounting', () => {
  it('computes byte sizes per format', () => {
    expect(pixelBufferBytes(100, 100, 'rgba8')).toBe(40000);
    expect(pixelBufferBytes(100, 100, 'rgba32f')).toBe(160000);
    expect(isWithinPixelBudget(100, 100, 'rgba8', 40000)).toBe(true);
    expect(isWithinPixelBudget(100, 100, 'rgba8', 39999)).toBe(false);
  });

  it('round-trips rgba32f → rgba8 with clamping', () => {
    const source = new Float32Array([0, 0.5, 1, 0.25, 1.5, -0.5, 0.999, 1]);
    const target = new Uint8ClampedArray(8);
    rgba32fToRgba8(source, target);
    expect(Array.from(target)).toEqual([0, 128, 255, 64, 255, 0, 255, 255]);
  });
});
