import { describe, expect, it } from 'vitest';
import {
  computeSourceRegionFromMaskBounds,
  computeSourceRegionFromMaskCoverage,
  computeSourceRegionFromPreviewMask,
  deriveGeneratedOverlay,
  encodeMaskCoverageAtSourceSize,
  encodePreviewMaskAtSourceSize,
  mapSourceRegionToProxy,
  sampleMaskCoverageToRegion,
  samplePreviewMaskToRegion,
  workingPixelBudgetForTier,
  workingRasterDimensions,
} from './generationRaster';

describe('bounded generative raster planning', () => {
  it('maps a preview selection to a padded source region', () => {
    const previewMask = new Uint8Array(100 * 50);
    for (let y = 10; y < 20; y += 1) {
      for (let x = 40; x < 50; x += 1) previewMask[y * 100 + x] = 255;
    }

    expect(computeSourceRegionFromPreviewMask(previewMask, 100, 50, 1000, 500, 10)).toEqual({
      x: 390,
      y: 90,
      width: 120,
      height: 120,
    });
    expect(computeSourceRegionFromPreviewMask(new Uint8Array(100 * 50), 100, 50, 1000, 500)).toBe(
      null,
    );
  });

  it('plans directly from a source-sized mask without preview rounding', () => {
    const sourceMask = new Uint8Array(12 * 8);
    for (let y = 2; y < 6; y += 1) {
      for (let x = 7; x < 10; x += 1) sourceMask[y * 12 + x] = 255;
    }

    expect(computeSourceRegionFromMaskCoverage(sourceMask, 12, 8, 1)).toEqual({
      x: 6,
      y: 1,
      width: 5,
      height: 6,
    });
    expect(
      sampleMaskCoverageToRegion(
        sourceMask,
        12,
        8,
        12,
        8,
        { x: 6, y: 1, width: 5, height: 6 },
        { width: 5, height: 6 },
      ),
    ).toEqual(
      Uint8Array.from({ length: 30 }, (_, index) => {
        const x = index % 5;
        const y = Math.floor(index / 5);
        return x >= 1 && x < 4 && y >= 1 && y < 5 ? 255 : 0;
      }),
    );
  });

  it('plans a bounded decode from persisted source-mask bounds', () => {
    expect(
      computeSourceRegionFromMaskBounds({ x: 880, y: 400, width: 120, height: 80 }, 1000, 600, 32),
    ).toEqual({ x: 848, y: 368, width: 152, height: 144 });
    expect(() =>
      computeSourceRegionFromMaskBounds({ x: 800, y: 400, width: 100, height: 80 }, 1000, 600, 32),
    ).not.toThrow();
    expect(() =>
      computeSourceRegionFromMaskBounds({ x: 950, y: 400, width: 100, height: 81 }, 1000, 600, 32),
    ).toThrow('Persisted mask bounds are invalid');
  });

  it('keeps the working raster bounded and preserves the region aspect ratio', () => {
    const region = { x: 0, y: 0, width: 4000, height: 2000 };
    expect(workingRasterDimensions(region, 2_000_000)).toEqual({ width: 2000, height: 1000 });
    expect(workingPixelBudgetForTier('constrained')).toBe(1_048_576);
    expect(workingPixelBudgetForTier('unknown')).toBe(2_000_000);
  });

  it('maps a bounded source region to the decoded proxy without stretching axes', () => {
    expect(
      mapSourceRegionToProxy({ x: 1000, y: 500, width: 2000, height: 1000 }, 8000, 4000, 1600, 800),
    ).toEqual({
      x: 200,
      y: 100,
      width: 400,
      height: 200,
    });
  });

  it('persists the editable mask at source dimensions with a streaming PNG', async () => {
    const dataUrl = await encodePreviewMaskAtSourceSize(
      Uint8Array.from([0, 255, 128, 64]),
      2,
      2,
      4,
      2,
    );
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1] ?? ''), (value) =>
      value.charCodeAt(0),
    );
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(header.getUint32(16)).toBe(4);
    expect(header.getUint32(20)).toBe(2);
    expect(bytes[25]).toBe(0); // grayscale PNG
  });

  it('encodes an existing source-sized mask without changing its rows', async () => {
    const coverage = Uint8Array.from([0, 64, 128, 255, 255, 128, 64, 0]);
    const exact = await encodeMaskCoverageAtSourceSize(coverage, 4, 2);
    const sameSizePreview = await encodePreviewMaskAtSourceSize(coverage, 4, 2, 4, 2);
    expect(exact).toBe(sameSizePreview);
  });

  it('honours cancellation before another source-resolution scanline', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodePreviewMaskAtSourceSize(Uint8Array.from([255]), 1, 1, 8, 8, controller.signal),
    ).rejects.toThrow('cancelled');
  });

  it('samples only the selected source rectangle instead of building a full mask', () => {
    const previewMask = Uint8Array.from([0, 255, 0, 0]);
    const sampled = samplePreviewMaskToRegion(
      previewMask,
      2,
      2,
      4,
      4,
      { x: 0, y: 0, width: 4, height: 2 },
      { width: 4, height: 2 },
    );

    expect(sampled).toHaveLength(8);
    expect(sampled[0]).toBe(0);
    expect(sampled[3]).toBeGreaterThan(sampled[1]!);
    expect(sampled[4]).toBe(0);
    expect(sampled[7]).toBeGreaterThan(sampled[5]!);
  });

  it('leaves unmasked pixels transparent in the generated overlay', () => {
    const source = new ImageData(2, 1);
    source.data.set([20, 30, 40, 255, 50, 60, 70, 255]);
    const result = new ImageData(2, 1);
    result.data.set([20, 30, 40, 255, 100, 110, 120, 255]);

    const overlay = deriveGeneratedOverlay(source, result, Uint8Array.from([0, 255]));

    expect(Array.from(overlay.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(overlay.data[7]).toBe(255);
    expect(overlay.data[4]).toBe(100);
    expect(overlay.data[5]).toBe(110);
    expect(overlay.data[6]).toBe(120);
  });

  it('solves soft coverage without applying the edge twice', () => {
    const source = new ImageData(1, 1);
    source.data.set([100, 100, 100, 255]);
    const result = new ImageData(1, 1);
    result.data.set([150, 150, 150, 255]);

    const overlay = deriveGeneratedOverlay(source, result, Uint8Array.from([128]));
    const alpha = (overlay.data[3] ?? 0) / 255;
    const recomposed = Math.round((overlay.data[0]! / 255) * alpha * 255 + 100 * (1 - alpha));

    expect(alpha).toBeCloseTo(128 / 255, 2);
    expect(recomposed).toBeCloseTo(150, 0);
  });
});
