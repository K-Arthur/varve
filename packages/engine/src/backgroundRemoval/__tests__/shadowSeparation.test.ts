import { describe, expect, it } from 'vitest';
import { extractCastShadow } from '../shadowSeparation';

/**
 * Helper: build an RGBA imageData from a 2-D matrix of [R, G, B] pixels.
 * The matrix is row-major (outer array = rows, inner = columns).
 */
function makeImage(pixels: [number, number, number][][]): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const height = pixels.length;
  const width = height > 0 ? pixels[0]!.length : 0;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y]![x]!;
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * Helper: build a 1-D foreground mask (0 = BG, 255 = FG) from a 2-D matrix
 * of booleans (true = foreground).
 */
function makeMask(pixels: boolean[][]): Uint8Array {
  const height = pixels.length;
  const width = height > 0 ? pixels[0]!.length : 0;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y]![x]) {
        mask[y * width + x] = 255;
      }
    }
  }
  return mask;
}

describe('extractCastShadow', () => {
  it('returns no shadow when foreground fills the entire image', () => {
    // 8x8 image where every pixel is foreground.
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 8; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 8; x++) {
        row.push([200, 200, 200]);
      }
      pixels.push(row);
    }
    const fgMask = new Uint8Array(8 * 8);
    fgMask.fill(255);

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      searchDistance: 10,
      minShadowSize: 1,
    });

    expect(result.hasShadow).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.regionCount).toBe(0);
  });

  it('detects a simple shadow adjacent to foreground', () => {
    // 16x12 image:
    //   Cols 0-4: foreground (light gray)
    //   Cols 5-7: shadow (darker, blue-ish) in bottom half
    //   Cols 5-7 top half + cols 8-15: unshadowed background
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 12; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 16; x++) {
        if (x < 5) {
          row.push([180, 180, 180]); // foreground
        } else if (x >= 5 && x <= 7 && y >= 4) {
          row.push([120, 125, 140]); // shadow (darker, blue-ish)
        } else {
          row.push([220, 220, 220]); // unshadowed background
        }
      }
      pixels.push(row);
    }

    const fgMask = new Uint8Array(16 * 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        fgMask[y * 16 + x] = x < 5 ? 255 : 0;
      }
    }

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      shadowThreshold: 10,
      searchDistance: 4,
      minShadowSize: 1,
      featherRadius: 0,
    });

    expect(result.hasShadow).toBe(true);
    expect(result.regionCount).toBeGreaterThanOrEqual(1);
    // Shadow mask should have non-zero values in the shadow region.
    for (let y = 4; y < 8; y++) {
      for (let x = 5; x <= 7; x++) {
        expect(result.shadowMask[y * 16 + x]).toBeGreaterThan(0);
      }
    }
  });

  it('extracts a shadow with a continuous alpha gradient', () => {
    // 16x12 image: foreground left side, shadow gradient immediately to
    // the right — darker near the foreground edge, fading outward.
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 12; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 16; x++) {
        if (x < 5) {
          row.push([180, 180, 180]); // foreground
        } else if (x >= 5 && x <= 8) {
          // Shadow gradient: darker near the foreground edge.
          const dark = Math.max(100, 210 - (x - 5) * 25);
          row.push([dark, dark, dark + 10]);
        } else {
          row.push([220, 220, 220]); // unshadowed background
        }
      }
      pixels.push(row);
    }

    const fgMask = new Uint8Array(16 * 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        fgMask[y * 16 + x] = x < 5 ? 255 : 0;
      }
    }

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      shadowThreshold: 5,
      searchDistance: 5,
      minShadowSize: 1,
      featherRadius: 0,
    });

    expect(result.hasShadow).toBe(true);
    expect(result.regionCount).toBeGreaterThanOrEqual(1);

    // The shadow gradient should have a range of alpha values.
    const alphas = new Set<number>();
    for (let y = 0; y < 12; y++) {
      for (let x = 5; x <= 8; x++) {
        const a = result.shadowMask[y * 16 + x] ?? 0;
        if (a > 0) alphas.add(a);
      }
    }
    // At least 2 distinct alpha levels in the gradient.
    expect(alphas.size).toBeGreaterThanOrEqual(2);
  });

  it('does not detect shadow when no luminance difference exists', () => {
    // Uniform background, uniform foreground — no shadow.
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 8; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 8; x++) {
        row.push([200, 200, 200]); // everything uniform
      }
      pixels.push(row);
    }

    const fgMask = new Uint8Array(8 * 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        fgMask[y * 8 + x] = x < 4 ? 255 : 0;
      }
    }

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      shadowThreshold: 20,
      searchDistance: 2,
      minShadowSize: 1,
    });

    expect(result.hasShadow).toBe(false);
    expect(result.regionCount).toBe(0);
  });

  it('finds multiple distinct shadow regions', () => {
    // 20x12 image with two horizontally-separated foreground patches, each
    // casting a shadow to its right.  Patches are 2x2, placed well apart
    // so the dilated search bands do not merge.
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 12; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 20; x++) {
        // Foreground patch 1: left side, rows 2-3, cols 2-3.
        if (x >= 2 && x <= 3 && y >= 2 && y <= 3) {
          row.push([180, 180, 180]);
        }
        // Foreground patch 2: right side, same rows, cols 14-15.
        else if (x >= 14 && x <= 15 && y >= 2 && y <= 3) {
          row.push([180, 180, 180]);
        }
        // Shadow behind patch 1 (cols 4-5, same rows).
        else if (x >= 4 && x <= 5 && y >= 2 && y <= 3) {
          row.push([120, 125, 140]);
        }
        // Shadow behind patch 2 (cols 16-17, same rows).
        else if (x >= 16 && x <= 17 && y >= 2 && y <= 3) {
          row.push([120, 125, 140]);
        }
        // Background.
        else {
          row.push([220, 220, 220]);
        }
      }
      pixels.push(row);
    }

    const fgMask = new Uint8Array(20 * 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 20; x++) {
        if ((x >= 2 && x <= 3 && y >= 2 && y <= 3) || (x >= 14 && x <= 15 && y >= 2 && y <= 3)) {
          fgMask[y * 20 + x] = 255;
        }
      }
    }

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      shadowThreshold: 10,
      searchDistance: 4,
      minShadowSize: 1,
      featherRadius: 0,
    });

    expect(result.hasShadow).toBe(true);
    expect(result.regionCount).toBeGreaterThanOrEqual(2);
  });

  it('estimates shadow colour within reasonable range', () => {
    // 16x12 image: foreground left, clearly blue-tinted shadow on right.
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 12; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 16; x++) {
        if (x < 5) {
          row.push([180, 180, 180]);
        } else if (x >= 5 && x <= 7) {
          row.push([90, 100, 130]); // blue-ish shadow
        } else {
          row.push([220, 220, 220]);
        }
      }
      pixels.push(row);
    }

    const fgMask = new Uint8Array(16 * 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        fgMask[y * 16 + x] = x < 5 ? 255 : 0;
      }
    }

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      shadowThreshold: 10,
      searchDistance: 4,
      minShadowSize: 1,
      featherRadius: 0,
    });

    expect(result.hasShadow).toBe(true);
    const [r, g, b, a] = result.shadowColor;
    // Shadow colour should be relatively dark.
    expect(r).toBeLessThan(200);
    expect(g).toBeLessThan(200);
    expect(b).toBeLessThan(200);
    // Alpha should be > 0 (shadow is semi-transparent).
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(255);
  });

  it('returns empty result for zero-size image', () => {
    const imageData = { data: new Uint8Array(0), width: 0, height: 0 };
    const fgMask = new Uint8Array(0);

    const result = extractCastShadow(imageData, fgMask);

    expect(result.hasShadow).toBe(false);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.shadowMask.length).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('returns no shadow for an all-background image (no foreground)', () => {
    const pixels: [number, number, number][][] = [];
    for (let y = 0; y < 8; y++) {
      const row: [number, number, number][] = [];
      for (let x = 0; x < 8; x++) {
        row.push([220, 220, 220]);
      }
      pixels.push(row);
    }

    const fgMask = new Uint8Array(8 * 8); // all zeros (no FG)

    const result = extractCastShadow(makeImage(pixels), fgMask, {
      searchDistance: 10,
      minShadowSize: 1,
    });

    expect(result.hasShadow).toBe(false);
    expect(result.regionCount).toBe(0);
    expect(result.confidence).toBe(0);
  });
});
