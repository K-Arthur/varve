import { describe, expect, it } from 'vitest';
import {
  applyAtmosphere,
  applyDefinition,
  applyDehaze,
  applyEdgeFalloff,
  applyGrain,
  applyMicroDetail,
  applySoftBloom,
} from './kernels';
import { imageTreatmentDefaults } from './schema';

function image(
  width: number,
  height: number,
  fill: (x: number, y: number) => readonly [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const pixel = fill(x, y);
      data[offset] = pixel[0];
      data[offset + 1] = pixel[1];
      data[offset + 2] = pixel[2];
      data[offset + 3] = pixel[3];
    }
  }
  return new ImageData(data, width, height);
}

function bytes(value: ImageData): number[] {
  return Array.from(value.data);
}

function copy(value: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(value.data), value.width, value.height);
}

const textured = () =>
  image(12, 10, (x, y) => {
    const base = 72 + x * 9 + y * 6;
    const texture = (x * 37 + y * 19) % 31;
    return [base + texture, base + texture / 2, base - texture / 3, 255];
  });

describe('Image Treatment kernels', () => {
  it('keeps every neutral default byte-identical', () => {
    const source = textured();
    const expected = bytes(source);

    applyMicroDetail(source, imageTreatmentDefaults('microDetail'));
    applyDefinition(source, imageTreatmentDefaults('definition'));
    applyAtmosphere(source, imageTreatmentDefaults('atmosphere'));
    applyDehaze(source, imageTreatmentDefaults('dehaze'));
    applyEdgeFalloff(source, imageTreatmentDefaults('edgeFalloff'));
    applyGrain(source, imageTreatmentDefaults('grain'));
    applySoftBloom(source, imageTreatmentDefaults('softBloom'));

    expect(bytes(source)).toEqual(expected);
  });

  it('changes only RGB of visible pixels and retains hidden pixel RGB', () => {
    const source = image(8, 8, (x, y) => {
      if (x === 0 && y === 0) return [17, 33, 49, 0];
      return [x < 4 ? 32 : 220, y * 8 + 64, 90, 170];
    });
    const expectedAlpha = Array.from(source.data).filter((_value, index) => index % 4 === 3);
    const hiddenRgb = Array.from(source.data.slice(0, 3));

    applyMicroDetail(source, { amount: 80, threshold: 0 });
    applyDefinition(source, { amount: 80, radius: 6, protectHighlights: 0 });
    applyAtmosphere(source, { amount: 80, radius: 8, protectHighlights: 0 });
    applyDehaze(source, { amount: 80, radius: 8, protectHighlights: 0 });
    applyEdgeFalloff(source, {
      strength: -80,
      midpoint: 40,
      feather: 60,
      roundness: 0,
      centerX: 0.5,
      centerY: 0.5,
      highlightProtection: 0,
    });
    applyGrain(source, { strength: 80, scale: 1, character: 50, seed: 9 });
    applySoftBloom(source, { strength: 70, radius: 6, threshold: 0.3, softness: 0.2 });

    expect(Array.from(source.data).filter((_value, index) => index % 4 === 3)).toEqual(
      expectedAlpha,
    );
    expect(Array.from(source.data.slice(0, 3))).toEqual(hiddenRgb);
  });

  it('recovers local contrast through a dark-channel haze estimate', () => {
    const source = image(25, 9, (x, y) => {
      // A muted foreground patch inside an evenly veiled field. Radius keeps
      // its veil estimate shared with its immediate surroundings, so a local
      // atmospheric-light inverse should expand the tonal separation.
      const foreground = x >= 8 && x <= 16 && y >= 2 && y <= 6;
      return foreground ? [112, 119, 126, 255] : [158, 165, 172, 255];
    });
    const sample = (x: number, y: number) => source.data[(y * source.width + x) * 4]!;
    const beforeGap = sample(4, 4) - sample(12, 4);

    applyDehaze(source, { amount: 100, radius: 12, protectHighlights: 0 });

    const afterGap = sample(4, 4) - sample(12, 4);
    expect(afterGap).toBeGreaterThan(beforeGap);
  });

  it('uses a different operator from Atmosphere rather than aliasing local contrast', () => {
    const dehazed = textured();
    const atmosphere = copy(dehazed);

    applyDehaze(dehazed, { amount: 65, radius: 32, protectHighlights: 0.3 });
    applyAtmosphere(atmosphere, { amount: 65, radius: 32, protectHighlights: 0.3 });

    expect(bytes(dehazed)).not.toEqual(bytes(atmosphere));
  });

  it('treats malformed direct API parameters as a safe neutral Dehaze', () => {
    const source = textured();
    const expected = bytes(source);

    applyDehaze(source, {
      amount: Number.NaN,
      radius: Number.POSITIVE_INFINITY,
      protectHighlights: Number.NaN,
    });

    expect(bytes(source)).toEqual(expected);
  });

  it('keeps deterministic grain fixed when a capture region moves with the camera', () => {
    const a = image(8, 8, () => [128, 128, 128, 255]);
    const b = copy(a);
    const params = { strength: 60, scale: 0.8, character: 65, seed: 42 };

    applyGrain(a, params, {
      treatmentSpace: {
        pixelToTreatment: [1, 0, 0, 1, 20, 40],
        bounds: { x: 20, y: 40, width: 8, height: 8 },
        pixelsPerUnit: 1,
      },
    });
    applyGrain(b, params, {
      treatmentSpace: {
        // Same document region after the camera origin and capture origin
        // moved together. A viewport-anchored implementation would differ.
        pixelToTreatment: [1, 0, 0, 1, 20, 40],
        bounds: { x: 20, y: 40, width: 8, height: 8 },
        pixelsPerUnit: 2,
      },
    });

    expect(bytes(a)).toEqual(bytes(b));
  });

  it('uses object-local bounds for Edge Falloff instead of temporary raster dimensions', () => {
    const source = image(7, 7, () => [160, 160, 160, 255]);
    applyEdgeFalloff(
      source,
      {
        strength: -90,
        midpoint: 50,
        feather: 40,
        roundness: 0,
        centerX: 0.5,
        centerY: 0.5,
        highlightProtection: 0,
      },
      {
        treatmentSpace: {
          // A 90° object rotation maps this temporary surface back to its
          // unrotated object coordinates.
          pixelToTreatment: [0, 1, -1, 0, 6, 0],
          bounds: { x: 0, y: 0, width: 6, height: 6 },
          pixelsPerUnit: 1,
        },
      },
    );

    const center = source.data[(3 * source.width + 3) * 4]!;
    const mappedTopEdge = source.data[(3 * source.width + 0) * 4]!;
    const mappedRightEdge = source.data[(6 * source.width + 3) * 4]!;
    expect(mappedTopEdge).toBeLessThan(center);
    expect(mappedRightEdge).toBeLessThan(center);
  });

  it('keeps treatment radii in stable source units across raster density', () => {
    const low = textured();
    const source = textured();
    const high = image(24, 20, (x, y) => {
      const sx = Math.floor(x / 2);
      const sy = Math.floor(y / 2);
      const offset = (sy * source.width + sx) * 4;
      return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!, 255];
    });

    applyDefinition(
      low,
      { amount: 70, radius: 6, protectHighlights: 0.3 },
      {
        treatmentSpace: { pixelsPerUnit: 1 },
      },
    );
    applyDefinition(
      high,
      { amount: 70, radius: 6, protectHighlights: 0.3 },
      {
        treatmentSpace: { pixelsPerUnit: 2 },
      },
    );

    const lowCenter = low.data[(5 * low.width + 6) * 4]!;
    const highCenter = high.data[(10 * high.width + 12) * 4]!;
    expect(Math.abs(lowCenter - highCenter)).toBeLessThanOrEqual(8);
  });
});
