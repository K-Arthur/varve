import { createRangeRaster, type RangeRaster } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  alignBracketFrames,
  buildDeghostMasks,
  decodeOpenExr,
  encodeOpenExr,
  fuseDisplayBracket,
  HdrProcessingError,
  mergeRadianceBracket,
  OpenExrError,
  rangeRasterToSrgbBytes,
  toneMapReinhardGlobal,
} from './index';

function makeRaster(
  values: readonly number[],
  options: {
    reference?: 'scene-linear' | 'display-linear' | 'display-referred';
    alpha?: number;
  } = {},
): RangeRaster {
  return createRangeRaster(
    {
      width: 2,
      height: 1,
      stride: 8,
      channelLayout: 'rgba',
      sampleType: 'float32',
      encoding: {
        model: 'rgb',
        primaries: 'srgb',
        transfer: 'linear',
        bitDepth: 'float32',
        alphaMode: 'straight',
        provenance: 'named',
      },
      reference: options.reference ?? 'scene-linear',
      referenceWhite: 1,
      alphaMode: 'straight',
      provenance: 'raw-development',
    },
    new Float32Array(values),
  );
}

describe('HDR processing', () => {
  it('aligns translation into reference coordinates and marks uncovered borders', () => {
    const reference = makePatternRaster(8, 6, (x, y) => {
      const value = x === 2 && y === 3 ? 4 : x + y + 1;
      return [value, value, value, 1];
    });
    const shifted = makePatternRaster(8, 6, (x, y) => {
      const sourceX = x - 2;
      const sourceY = y - 1;
      if (sourceX < 0 || sourceY < 0 || sourceX >= 8 || sourceY >= 6) return [0, 0, 0, 0];
      const value = sourceX === 2 && sourceY === 3 ? 4 : sourceX + sourceY + 1;
      return [value, value, value, 1];
    });
    const result = alignBracketFrames(
      [
        { raster: reference, exposureTimeSeconds: 1 },
        { raster: shifted, exposureTimeSeconds: 2 },
      ],
      { referenceIndex: 0, maxTranslationPx: 3, proxyMaxDimension: 32 },
    );
    expect(result.transforms[1]).toMatchObject({ dx: 2, dy: 1 });
    expect(result.frames[1]!.raster.pixels[7 * 4 + 3]).toBe(0);
    expect(result.frames[1]!.raster.pixels[(3 * 8 + 2) * 4]).toBe(4);
  });

  it('deghosts divergent non-reference samples without inventing detail', () => {
    const base = makePatternRaster(3, 1, (x) => [x === 1 ? 0.3 : 0.2, 0.2, 0.2, 1]);
    const moving = makePatternRaster(3, 1, (x) => [x === 1 ? 0.95 : 0.2, 0.2, 0.2, 1]);
    const result = buildDeghostMasks(
      [
        { raster: base, exposureTimeSeconds: 1 },
        { raster: moving, exposureTimeSeconds: 1 },
      ],
      { referenceIndex: 0, differenceThreshold: 0.5 },
    );
    expect(result.validMasks[0]).toEqual(new Uint8Array([1, 1, 1]));
    expect(result.validMasks[1]).toEqual(new Uint8Array([1, 0, 1]));
    expect(result.movingPixels).toBe(1);
  });

  it('normalizes rendered exposure changes before classifying localized motion', () => {
    const reference = makePatternRaster(16, 8, (x, y) => [
      0.25 + x * 0.01 + y * 0.005,
      0.2,
      0.15,
      1,
    ]);
    const rendered = makePatternRaster(16, 8, (x, y) => {
      if (x >= 6 && x <= 9 && y >= 3 && y <= 5) return [0.01, 0.01, 0.01, 1];
      const scale = 0.5;
      return [(0.25 + x * 0.01 + y * 0.005) * scale, 0.2 * scale, 0.15 * scale, 1];
    });
    const result = buildDeghostMasks([{ raster: reference }, { raster: rendered }], {
      referenceIndex: 0,
      differenceThreshold: 0.35,
      normalization: 'rendered-local-contrast',
    });
    expect(result.validMasks[1]!.filter((value) => value === 0)).toHaveLength(24);
    const motionCandidates = Array.from(result.validMasks[1]!)
      .map((value, index) => (value === 0 ? [index % 16, Math.floor(index / 16)] : null))
      .filter((value): value is [number, number] => value !== null);
    expect(motionCandidates.every(([x, y]) => x >= 5 && x <= 10 && y >= 2 && y <= 6)).toBe(true);
    expect(result.movingPixels).toBe(24);
    expect(result.warnings).toContain(
      'rendered-input deghosting used an exposure-relative local-contrast and spatial consistency check; it is not camera response calibration',
    );
  });

  it('normalizes reviewed linear bracket exposures into one radiance master', () => {
    const result = mergeRadianceBracket(
      [
        { raster: makeRaster([0.1, 0.15, 0.18, 1, 0.1, 0.15, 0.18, 1]), exposureTimeSeconds: 0.2 },
        { raster: makeRaster([0.2, 0.3, 0.36, 1, 0.2, 0.3, 0.36, 1]), exposureTimeSeconds: 0.4 },
        { raster: makeRaster([0.4, 0.6, 0.72, 1, 0.4, 0.6, 0.72, 1]), exposureTimeSeconds: 0.8 },
      ],
      { referenceIndex: 1 },
    );

    expect(result.raster.contract.provenance).toBe('hdr-radiance');
    expect(result.raster.contract.reference).toBe('scene-linear');
    expect(result.raster.pixels[0]).toBeCloseTo(0.5, 3);
    expect(result.raster.pixels[1]).toBeCloseTo(0.75, 3);
    expect(result.raster.pixels[2]).toBeCloseTo(0.9, 3);
    expect(result.validMask[0]).toBe(1);
    expect(result.diagnostics.method).toBe('radiance');
  });

  it('requires explicit exposure values and rejects encoded input for radiance math', () => {
    expect(() =>
      mergeRadianceBracket(
        [
          { raster: makeRaster([0, 0, 0, 1, 0, 0, 0, 1]) },
          { raster: makeRaster([0, 0, 0, 1, 0, 0, 0, 1]) },
        ],
        { referenceIndex: 0 },
      ),
    ).toThrow(HdrProcessingError);
    const encoded = makeRaster([0.2, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 1]);
    encoded.contract.encoding.transfer = 'srgb';
    expect(() =>
      mergeRadianceBracket(
        [
          { raster: encoded, exposureTimeSeconds: 1 },
          { raster: encoded, exposureTimeSeconds: 2 },
        ],
        { referenceIndex: 0 },
      ),
    ).toThrow(/linear input/);
  });

  it('keeps display-referred fusion distinct from radiance reconstruction', () => {
    const result = fuseDisplayBracket([
      {
        raster: makeRaster([0.1, 0.2, 0.3, 1, 0.1, 0.2, 0.3, 1], { reference: 'display-referred' }),
      },
      {
        raster: makeRaster([0.7, 0.6, 0.5, 1, 0.7, 0.6, 0.5, 1], { reference: 'display-referred' }),
      },
    ]);
    expect(result.raster.contract.provenance).toBe('hdr-exposure-fusion');
    expect(result.diagnostics.warnings[0]).toMatch(/does not reconstruct/);
    expect(result.raster.pixels[0]).toBeGreaterThan(0.1);
    expect(result.raster.pixels[0]).toBeLessThan(0.7);
  });

  it('tone maps a full-frame master without mutating above-white source values', () => {
    const source = makeRaster([0.25, 1, 4, 1, 2, 3, 8, 1]);
    const result = toneMapReinhardGlobal(source);
    expect(source.pixels[2]).toBe(4);
    expect(result.raster.pixels[0]).toBeLessThan(result.raster.pixels[4]!);
    expect(result.raster.pixels[4]).toBeLessThan(1);
    expect(rangeRasterToSrgbBytes(result.raster)[2]).toBeGreaterThan(0);
  });
});

function makePatternRaster(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
) {
  const raster = createRangeRaster({
    width,
    height,
    stride: width * 4,
    channelLayout: 'rgba',
    sampleType: 'float32',
    encoding: {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'linear',
      bitDepth: 'float32',
      alphaMode: 'straight',
      provenance: 'named',
    },
    reference: 'scene-linear',
    referenceWhite: 1,
    alphaMode: 'straight',
    provenance: 'raw-development',
  });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raster.pixels.set(pixel(x, y), (y * width + x) * 4);
  }
  return raster;
}

describe('OpenEXR verified subset', () => {
  it('round-trips extended, negative, and fractional-alpha float32 values', () => {
    const source = makeRaster([-0.25, 1, 4, 0.5, 2, 3, 8, 1]);
    const encoded = encodeOpenExr(source);
    const decoded = decodeOpenExr(encoded);
    expect(decoded.channels).toEqual(['B', 'G', 'R', 'A']);
    expect(decoded.raster.contract.reference).toBe('scene-linear');
    expect(decoded.raster.pixels[0]).toBeCloseTo(-0.25, 5);
    expect(decoded.raster.pixels[1]).toBeCloseTo(1, 5);
    expect(decoded.raster.pixels[2]).toBeCloseTo(4, 5);
    expect(decoded.raster.pixels[3]).toBeCloseTo(0.5, 5);
    expect(decoded.raster.contract.provenance).toBe('raw-development');
    expect(decoded.raster.contract.encoding.provenance).toBe('named');
    expect(decoded.dataWindow).toEqual({ xMin: 0, yMin: 0, xMax: 1, yMax: 0 });
  });

  it('does not discard straight RGB when alpha is intentionally omitted', () => {
    const source = makeRaster([0.8, 0.4, 0.2, 0.25, 0, 0, 0, 0]);
    const decoded = decodeOpenExr(encodeOpenExr(source, { includeAlpha: false }));
    expect(decoded.channels).toEqual(['B', 'G', 'R']);
    expect(decoded.raster.pixels[0]).toBeCloseTo(0.8, 6);
    expect(decoded.raster.pixels[1]).toBeCloseTo(0.4, 6);
    expect(decoded.raster.pixels[2]).toBeCloseTo(0.2, 6);
    expect(decoded.raster.pixels[3]).toBe(1);
  });

  it('makes half-float overflow an explicit caller choice', () => {
    const source = makeRaster([70_000, 0, 0, 1, 0, 0, 0, 1]);
    expect(() => encodeOpenExr(source, { precision: 'float16' })).toThrow(OpenExrError);
    const decoded = decodeOpenExr(
      encodeOpenExr(source, { precision: 'float16', halfOverflow: 'clamp' }),
    );
    expect(decoded.raster.pixels[0]).toBeCloseTo(65_504, -1);
    expect(decoded.warnings).toContain('decoded from half-float samples');
  });

  it('rejects malformed or unsupported EXR input before allocation', () => {
    expect(() => decodeOpenExr(new Uint8Array([0, 1, 2]))).toThrow(OpenExrError);
    const source = makeRaster([1, 1, 1, 1, 1, 1, 1, 1]);
    const encoded = encodeOpenExr(source);
    expect(() => decodeOpenExr(encoded.slice(0, encoded.length - 4))).toThrow(OpenExrError);
  });
});
