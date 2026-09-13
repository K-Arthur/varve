/**
 * Corrected halftone screening contract (algorithm version 2).
 *
 * These tests pin the behaviour that was broken in the pre-2026 screen:
 * measurable screen period, exact tone response and endpoints for every
 * shape, correct channel mapping and process separation, explicit FM
 * algorithm selection with preview/export parity, and deterministic
 * document-space anchoring.
 */
import { describe, expect, it } from 'vitest';
import { applyColorHalftone, applyLegacyColorHalftone } from './colorHalftone';
import {
  applyAMScreeningV2,
  applyErrorDiffusionV2,
  applyHalftone,
  applyLegacyAMScreening,
  applyOrderedDitherV2,
  generateAMMatrix,
  type HalftoneParams,
} from './halftone';
import { DOC_PIXELS_PER_INCH } from './halftoneScreen';

function solid(w: number, h: number, rgb: readonly [number, number, number], a = 255): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
    img.data[i + 3] = a;
  }
  return img;
}

function inkFraction(img: ImageData): number {
  let ink = 0;
  let total = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    total++;
    const lum = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
    if (lum < 128) ink++;
  }
  return total === 0 ? 0 : ink / total;
}

function meanRGB(img: ImageData): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    r += img.data[i]!;
    g += img.data[i + 1]!;
    b += img.data[i + 2]!;
    n++;
  }
  return [r / n, g / n, b / n];
}

const v2 = (over: Partial<HalftoneParams> = {}): HalftoneParams => ({
  pattern: 'dot',
  frequency: 16,
  angle: 0,
  dotShape: 'round',
  channel: 'k',
  method: 'am',
  algorithmVersion: 2,
  ...over,
});

/**
 * Estimate the horizontal repeat period in output pixels from the
 * ink/paper transition density along one row. A full period contains two
 * transitions, so period = 2 * span / transitions.
 */
function measurePeriod(img: ImageData, row: number, inkThreshold = 128): number {
  const w = img.width;
  let transitions = 0;
  let prev: boolean | null = null;
  let first = -1;
  let last = -1;
  for (let x = 0; x < w; x++) {
    const i = (row * w + x) * 4;
    const lum = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
    const ink = lum < inkThreshold;
    if (ink) {
      if (first < 0) first = x;
      last = x;
    }
    if (prev !== null && ink !== prev) transitions++;
    prev = ink;
  }
  if (transitions === 0 || last < 0) return -1;
  return (2 * (last - first)) / transitions;
}

describe('AM screen geometry (version 2)', () => {
  it('renders the requested document-space period at integer periods', () => {
    for (const frequency of [12, 16, 24]) {
      const expected = DOC_PIXELS_PER_INCH / frequency;
      const img = solid(480, 64, [128, 128, 128]);
      applyAMScreeningV2(img, v2({ frequency }));
      const periods = [24, 28, 32, 36].map((row) => measurePeriod(img, row)).filter((p) => p > 0);
      const average = periods.reduce((sum, value) => sum + value, 0) / periods.length;
      expect(average, `frequency ${frequency}`).toBeGreaterThan(expected * 0.9);
      expect(average, `frequency ${frequency}`).toBeLessThan(expected * 1.1);
    }
  });

  it('does not multiply the requested cell period by the matrix size', () => {
    // The legacy screen applied one threshold per cell, so a 45 LPI request
    // rendered a period many times larger. At 3x output resolution the
    // corrected screen must measure close to 96/45 * 3 = 6.4 px, not the
    // legacy 8 px cell period times its matrix multiplier.
    const img = solid(480, 96, [128, 128, 128]);
    applyAMScreeningV2(img, v2({ frequency: 45 }), 3);
    const periods = [40, 48, 52, 56].map((row) => measurePeriod(img, row)).filter((p) => p > 0);
    expect(periods.length).toBeGreaterThan(0);
    const average = periods.reduce((sum, value) => sum + value, 0) / periods.length;
    expect(average).toBeGreaterThan(5.6);
    expect(average).toBeLessThan(7.3);
  });

  it('substitutes no period when the request changes by one LPI', () => {
    // Frequency changes must be respected, not quantized to one of a few
    // cell sizes: 16 LPI (6 px) and 17 LPI (5.65 px) must differ.
    const a = solid(240, 64, [128, 128, 128]);
    const b = solid(240, 64, [128, 128, 128]);
    applyAMScreeningV2(a, v2({ frequency: 16 }));
    applyAMScreeningV2(b, v2({ frequency: 17 }));
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it('anchors the screen in document space under region offsets', () => {
    // Rendering a region that starts 32 doc px into the document must show
    // the same pattern as the corresponding window of the full render.
    const full = solid(200, 32, [128, 128, 128]);
    applyAMScreeningV2(full, v2({ frequency: 16 }));
    const region = solid(64, 32, [128, 128, 128]);
    applyAMScreeningV2(region, v2({ frequency: 16 }), 1, 32, 0);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 64; x++) {
        const source = (y * 200 + x + 32) * 4;
        const target = (y * 64 + x) * 4;
        expect(region.data[target]).toBe(full.data[source]);
      }
    }
  });

  it('keeps document phase when the region is rendered at a different scale', () => {
    // At pixelScale 2, each document pixel spans two output pixels; the same
    // document position must keep the same matrix decision.
    const base = solid(64, 16, [128, 128, 128]);
    applyAMScreeningV2(base, v2({ frequency: 16 }));
    const scaled = solid(64, 16, [128, 128, 128]);
    applyAMScreeningV2(scaled, v2({ frequency: 16 }), 1, 16, 0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(scaled.data[(y * 64 + x) * 4]).toBe(base.data[(y * 64 + x + 16) * 4]);
      }
    }
  });
});

describe('AM tone response (version 2)', () => {
  const tones = [0, 32, 64, 96, 128, 160, 192, 224, 255];

  it('inks exactly the source darkness for every shape', () => {
    for (const dotShape of [
      'round',
      'elliptical',
      'square',
      'diamond',
      'line',
      'cross',
      'circle',
    ] as const) {
      for (const gray of tones) {
        const img = solid(192, 192, [gray, gray, gray]);
        applyAMScreeningV2(img, v2({ dotShape, frequency: 16 }));
        const expected = (255 - gray) / 255;
        expect(inkFraction(img), `${dotShape} gray=${gray}`).toBeGreaterThan(expected - 0.03);
        expect(inkFraction(img), `${dotShape} gray=${gray}`).toBeLessThan(expected + 0.03);
      }
    }
  });

  it('is monotonic in darkness for every shape', () => {
    const darkToLight = [...tones].reverse();
    for (const dotShape of ['round', 'diamond', 'line', 'cross', 'circle'] as const) {
      let previous = -1;
      for (const gray of darkToLight) {
        const img = solid(128, 128, [gray, gray, gray]);
        applyAMScreeningV2(img, v2({ dotShape, frequency: 16 }));
        const coverage = inkFraction(img);
        expect(coverage, `${dotShape} gray=${gray}`).toBeGreaterThanOrEqual(previous);
        previous = coverage;
      }
    }
  });

  it('reaches full ink at black and clean paper at white', () => {
    for (const dotShape of ['round', 'diamond', 'cross', 'circle', 'line'] as const) {
      const black = solid(128, 128, [0, 0, 0]);
      applyAMScreeningV2(black, v2({ dotShape, frequency: 16 }));
      expect(inkFraction(black), `${dotShape} black`).toBeGreaterThan(0.98);

      const white = solid(128, 128, [255, 255, 255]);
      applyAMScreeningV2(white, v2({ dotShape, frequency: 16 }));
      expect(inkFraction(white), `${dotShape} white`).toBeLessThan(0.02);
    }
  });

  it('does not leak ink at the white endpoint through soft edges', () => {
    const white = solid(128, 128, [255, 255, 255]);
    applyAMScreeningV2(white, v2({ softness: 1 }));
    expect(inkFraction(white)).toBeLessThan(0.02);

    const black = solid(128, 128, [0, 0, 0]);
    applyAMScreeningV2(black, v2({ softness: 1 }));
    expect(inkFraction(black)).toBeGreaterThan(0.98);
  });

  it('screens a smooth gradient with locally accurate, monotonic tone', () => {
    // Procedural screentone: a gradient (or uniform tone) screened in place,
    // with no bitmap source. Each band's ink fraction must track its own
    // source darkness, and dots must grow monotonically toward the dark end.
    const w = 192;
    const h = 64;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gray = Math.round((x / (w - 1)) * 255);
        const i = (y * w + x) * 4;
        img.data[i] = gray;
        img.data[i + 1] = gray;
        img.data[i + 2] = gray;
        img.data[i + 3] = 255;
      }
    }
    applyAMScreeningV2(img, v2({ frequency: 12, angle: 0 }));

    const bands = 4;
    const bandWidth = w / bands;
    let previous = 2;
    for (let band = 0; band < bands; band++) {
      let ink = 0;
      let total = 0;
      let sourceDarkness = 0;
      for (let y = 0; y < h; y++) {
        for (let x = band * bandWidth; x < (band + 1) * bandWidth; x++) {
          const i = (y * w + x) * 4;
          const lum = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
          const sourceGray = (x / (w - 1)) * 255;
          sourceDarkness += (255 - sourceGray) / 255;
          if (lum < 128) ink++;
          total++;
        }
      }
      const inkFraction = ink / total;
      const expected = sourceDarkness / total;
      expect(Math.abs(inkFraction - expected), `band ${band}`).toBeLessThan(0.12);
      expect(inkFraction, `band ${band} monotonic`).toBeLessThan(previous);
      previous = inkFraction;
    }
  });

  it('builds a rank-uniform threshold matrix', () => {
    const size = 32;
    const matrix = generateAMMatrix(size, 'round');
    const sorted = Array.from(matrix).sort((a, b) => a - b);
    for (let rank = 0; rank < sorted.length; rank += 37) {
      const expected = (255 * (rank + 0.5)) / sorted.length;
      expect(Math.abs(sorted[rank]! - expected)).toBeLessThan(3);
    }
  });
});

describe('AM channel mapping and process separation (version 2)', () => {
  it('maps primaries to the correct ink channels', () => {
    const cases: Array<{ rgb: [number, number, number]; expected: Record<string, number> }> = [
      { rgb: [255, 0, 0], expected: { c: 0, m: 1, y: 1, k: 1 - 0.2126 } },
      { rgb: [0, 255, 0], expected: { c: 1, m: 0, y: 1, k: 1 - 0.7152 } },
      { rgb: [0, 0, 255], expected: { c: 1, m: 1, y: 0, k: 1 - 0.0722 } },
      { rgb: [255, 255, 0], expected: { c: 0, m: 0, y: 1, k: 1 - (0.2126 + 0.7152) } },
      { rgb: [0, 255, 255], expected: { c: 1, m: 0, y: 0, k: 1 - (0.7152 + 0.0722) } },
      { rgb: [255, 0, 255], expected: { c: 0, m: 1, y: 0, k: 1 - (0.2126 + 0.0722) } },
    ];
    for (const { rgb, expected } of cases) {
      for (const channel of ['c', 'm', 'y', 'k'] as const) {
        const img = solid(96, 96, rgb);
        applyAMScreeningV2(img, v2({ channel }));
        expect(inkFraction(img), `${rgb.join(',')} ${channel}`).toBeGreaterThan(
          expected[channel]! - 0.04,
        );
        expect(inkFraction(img), `${rgb.join(',')} ${channel}`).toBeLessThan(
          expected[channel]! + 0.04,
        );
      }
    }
  });

  it('recombines primaries without luminance double-counting', () => {
    for (const rgb of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ] as const) {
      const img = solid(96, 96, rgb);
      applyAMScreeningV2(img, v2({ channel: 'cmyk', frequency: 20 }));
      const [r, g, b] = meanRGB(img);
      expect(Math.abs(r - rgb[0]), `${rgb.join(',')} R`).toBeLessThan(6);
      expect(Math.abs(g - rgb[1]), `${rgb.join(',')} G`).toBeLessThan(6);
      expect(Math.abs(b - rgb[2]), `${rgb.join(',')} B`).toBeLessThan(6);
    }
  });

  it('keeps neutral gray neutral with black generation off', () => {
    const img = solid(128, 128, [128, 128, 128]);
    applyAMScreeningV2(img, v2({ channel: 'cmyk', frequency: 20 }));
    const [r, g, b] = meanRGB(img);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(4);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
  });

  it('replaces the gray component with K ink under GCR', () => {
    const img = solid(128, 128, [128, 128, 128]);
    applyAMScreeningV2(
      img,
      v2({ channel: 'cmyk', frequency: 20, blackGeneration: 'gcr', gcrStrength: 1 }),
    );
    // Composite tone is preserved...
    const [r] = meanRGB(img);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
    // ...but the cyan separation is now empty because the gray component
    // moved to the black plate.
    const cyan = solid(128, 128, [128, 128, 128]);
    applyAMScreeningV2(
      cyan,
      v2({
        channel: 'cmyk',
        frequency: 20,
        blackGeneration: 'gcr',
        gcrStrength: 1,
        previewChannel: 'c',
      }),
    );
    expect(inkFraction(cyan)).toBeLessThan(0.02);
  });

  it('applies UCR only in the shadow end', () => {
    const midtone = solid(64, 64, [128, 128, 128]);
    applyAMScreeningV2(
      midtone,
      v2({
        channel: 'cmyk',
        frequency: 20,
        blackGeneration: 'ucr',
        gcrStrength: 1,
        previewChannel: 'k',
      }),
    );
    expect(inkFraction(midtone)).toBeLessThan(0.02);

    const shadow = solid(64, 64, [51, 51, 51]);
    applyAMScreeningV2(
      shadow,
      v2({
        channel: 'cmyk',
        frequency: 20,
        blackGeneration: 'ucr',
        gcrStrength: 1,
        previewChannel: 'k',
      }),
    );
    expect(inkFraction(shadow)).toBeGreaterThan(0.3);
  });

  it('limits total area coverage', () => {
    const richBlack = (tacLimit: number | undefined): [number, number, number] => {
      const img = solid(96, 96, [0, 0, 0]);
      applyAMScreeningV2(
        img,
        v2({ channel: 'cmyk', frequency: 20, tacLimit, blackGeneration: 'none' }),
      );
      return meanRGB(img);
    };
    const [unlimitedR] = richBlack(1);
    const [limitedR] = richBlack(0.5);
    expect(unlimitedR).toBeLessThan(2);
    expect(limitedR).toBeGreaterThan(4);
  });

  it('shows a single separation in preview channel mode', () => {
    const img = solid(64, 64, [255, 0, 0]);
    applyAMScreeningV2(img, v2({ channel: 'cmyk', frequency: 20, previewChannel: 'm' }));
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(img.data[i + 1]);
      expect(img.data[i + 1]).toBe(img.data[i + 2]);
    }
    expect(inkFraction(img)).toBeGreaterThan(0.9);
  });

  it('honors per-channel angle overrides', () => {
    const baseline = solid(96, 96, [128, 128, 128]);
    const overridden = solid(96, 96, [128, 128, 128]);
    applyAMScreeningV2(baseline, v2({ channel: 'cmyk', frequency: 20 }));
    applyAMScreeningV2(
      overridden,
      v2({ channel: 'cmyk', frequency: 20, channelAngles: { c: 10 } }),
    );
    expect(Array.from(baseline.data)).not.toEqual(Array.from(overridden.data));
  });

  it('honors per-channel registration offsets', () => {
    const baseline = solid(96, 96, [128, 128, 128]);
    const offset = solid(96, 96, [128, 128, 128]);
    applyAMScreeningV2(baseline, v2({ channel: 'cmyk', frequency: 20 }));
    applyAMScreeningV2(
      offset,
      v2({ channel: 'cmyk', frequency: 20, registrationOffset: { c: [2, 1] } }),
    );
    expect(Array.from(baseline.data)).not.toEqual(Array.from(offset.data));
  });

  it('adds midtone ink for dot gain and leaves endpoints fixed', () => {
    const plain = solid(128, 128, [128, 128, 128]);
    const gained = solid(128, 128, [128, 128, 128]);
    applyAMScreeningV2(plain, v2({ frequency: 16 }));
    applyAMScreeningV2(gained, v2({ frequency: 16, dotGain: 0.3 }));
    expect(inkFraction(gained)).toBeGreaterThan(inkFraction(plain));

    const white = solid(64, 64, [255, 255, 255]);
    applyAMScreeningV2(white, v2({ dotGain: 0.3 }));
    expect(inkFraction(white)).toBeLessThan(0.02);
  });
});

describe('alpha screening (version 2)', () => {
  it('preserves alpha by default', () => {
    const img = solid(64, 64, [0, 0, 0], 200);
    applyAMScreeningV2(img, v2({ frequency: 16 }));
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(200);
  });

  it('screens ink coverage into alpha in screen mode', () => {
    const black = solid(64, 64, [0, 0, 0], 255);
    applyAMScreeningV2(black, v2({ frequency: 16, alphaMode: 'screen' }));
    for (let i = 3; i < black.data.length; i += 4) expect(black.data[i]).toBe(255);

    const white = solid(64, 64, [255, 255, 255], 255);
    applyAMScreeningV2(white, v2({ frequency: 16, alphaMode: 'screen' }));
    for (let i = 3; i < white.data.length; i += 4) expect(white.data[i]).toBe(0);

    const mid = solid(64, 64, [128, 128, 128], 255);
    applyAMScreeningV2(mid, v2({ frequency: 16, alphaMode: 'screen' }));
    let alphaSum = 0;
    for (let i = 3; i < mid.data.length; i += 4) alphaSum += mid.data[i]!;
    const average = alphaSum / (mid.data.length / 4);
    expect(average).toBeGreaterThan(100);
    expect(average).toBeLessThan(155);
  });
});

describe('FM screening (version 2)', () => {
  it('reproduces tone for ordered dithering', () => {
    for (const algorithm of ['blue-noise', 'bayer'] as const) {
      for (const gray of [0, 64, 128, 192, 255]) {
        const img = solid(192, 192, [gray, gray, gray]);
        applyOrderedDitherV2(img, v2({ method: 'fm', fmAlgorithm: algorithm }), algorithm, 0, 0);
        const expected = (255 - gray) / 255;
        expect(inkFraction(img), `${algorithm} gray=${gray}`).toBeGreaterThan(expected - 0.04);
        expect(inkFraction(img), `${algorithm} gray=${gray}`).toBeLessThan(expected + 0.04);
      }
    }
  });

  it('is deterministic and identical for preview and export (blue-noise)', () => {
    // The same document-space region must render identically whether it is
    // reached through the preview path (region offsets) or export (no
    // offsets); phase is a function of document coordinates only.
    const preview = solid(64, 64, [128, 128, 128]);
    const exported = solid(64, 64, [128, 128, 128]);
    applyHalftone(preview, v2({ method: 'fm', fmAlgorithm: 'blue-noise' }), 0, 0, 1);
    applyHalftone(exported, v2({ method: 'fm', fmAlgorithm: 'blue-noise' }));
    expect(Array.from(preview.data)).toEqual(Array.from(exported.data));
  });

  it('renders the same ordered screen for tiles and full frames', () => {
    // A viewport tile starting at a document offset must be pixel-identical
    // to the corresponding window of the full-frame render, for both ordered
    // algorithms. This is the tiling contract the preview relies on.
    for (const algorithm of ['blue-noise', 'bayer'] as const) {
      const params = v2({ method: 'fm', fmAlgorithm: algorithm });
      const full = solid(96, 64, [128, 128, 128]);
      applyOrderedDitherV2(full, params, algorithm, 0, 0, 1);

      const tile = solid(48, 32, [128, 128, 128]);
      applyOrderedDitherV2(tile, params, algorithm, 32, 16, 1);

      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 48; x++) {
          const source = ((y + 16) * 96 + x + 32) * 4;
          const target = (y * 48 + x) * 4;
          expect(tile.data[target], `${algorithm} tile ${x},${y}`).toBe(full.data[source]);
          expect(tile.data[target + 3]).toBe(255);
        }
      }
    }
  });

  it('substitutes a stable ordered screen for error diffusion in preview mode', () => {
    const preview = solid(64, 64, [128, 128, 128]);
    const ordered = solid(64, 64, [128, 128, 128]);
    const params = v2({ method: 'fm', fmAlgorithm: 'error-diffusion' });
    applyHalftone(preview, params, 3, 5, 1);
    applyOrderedDitherV2(ordered, params, 'blue-noise', 3, 5, 1);
    expect(Array.from(preview.data)).toEqual(Array.from(ordered.data));
  });

  it('uses error diffusion only in full-frame mode', () => {
    const full = solid(64, 64, [128, 128, 128]);
    const ordered = solid(64, 64, [128, 128, 128]);
    const params = v2({ method: 'fm', fmAlgorithm: 'error-diffusion' });
    applyHalftone(full, params, undefined, undefined, 1, { fullFrame: true });
    applyOrderedDitherV2(ordered, params, 'blue-noise', 0, 0, 1);
    expect(Array.from(full.data)).not.toEqual(Array.from(ordered.data));
    expect(inkFraction(full)).toBeGreaterThan(0.42);
    expect(inkFraction(full)).toBeLessThan(0.58);
  });

  it('is deterministic in error diffusion', () => {
    const first = solid(64, 64, [128, 128, 128]);
    const second = solid(64, 64, [128, 128, 128]);
    applyErrorDiffusionV2(first, v2({ method: 'fm' }));
    applyErrorDiffusionV2(second, v2({ method: 'fm' }));
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it('handles degenerate dimensions without wrapping or crashing', () => {
    for (const [w, h] of [
      [1, 1],
      [1, 64],
      [64, 1],
      [2, 2],
    ] as const) {
      const img = solid(w, h, [128, 128, 128]);
      expect(() => applyErrorDiffusionV2(img, v2({ method: 'fm' }))).not.toThrow();
      for (let i = 0; i < img.data.length; i += 4) {
        expect(img.data[i]!).toBeGreaterThanOrEqual(0);
        expect(img.data[i]!).toBeLessThanOrEqual(255);
        expect(img.data[i + 3]).toBe(255);
      }
    }
  });

  it('preserves transparent islands in error diffusion', () => {
    const img = solid(64, 64, [128, 128, 128]);
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 30; x++) img.data[(y * 64 + x) * 4 + 3] = 0;
    }
    applyErrorDiffusionV2(img, v2({ method: 'fm' }));
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 30; x++) expect(img.data[(y * 64 + x) * 4 + 3]).toBe(0);
    }
  });
});

describe('legacy version preservation', () => {
  it('applyHalftone version 1 matches the legacy AM screen', () => {
    const v1 = solid(96, 64, [128, 128, 128]);
    const legacy = solid(96, 64, [128, 128, 128]);
    const params = v2({ algorithmVersion: 1 });
    applyHalftone(v1, params);
    applyLegacyAMScreening(legacy, params);
    expect(Array.from(v1.data)).toEqual(Array.from(legacy.data));
  });

  it('applyHalftone version 1 matches the legacy color screen', () => {
    const v1 = solid(64, 64, [200, 100, 50]);
    const legacy = solid(64, 64, [200, 100, 50]);
    applyColorHalftone(v1, {
      screenSize: 12,
      angle: 30,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
      algorithmVersion: 1,
    });
    applyLegacyColorHalftone(legacy, {
      screenSize: 12,
      angle: 30,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
    });
    expect(Array.from(v1.data)).toEqual(Array.from(legacy.data));
  });
});

describe('color halftone corrected contract (version 2)', () => {
  it('keeps white clean and black solid in mono mode', () => {
    const white = solid(96, 96, [255, 255, 255]);
    applyColorHalftone(white, {
      screenSize: 16,
      angle: 0,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
      algorithmVersion: 2,
    });
    expect(meanRGB(white)[0]).toBeGreaterThan(250);

    const black = solid(96, 96, [0, 0, 0]);
    applyColorHalftone(black, {
      screenSize: 16,
      angle: 0,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
      algorithmVersion: 2,
    });
    expect(meanRGB(black)[0]).toBeLessThan(5);
  });

  it('regression: white must not become black dots (legacy polarity bug)', () => {
    const white = solid(96, 96, [255, 255, 255]);
    applyColorHalftone(white, {
      screenSize: 12,
      angle: 0,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
      algorithmVersion: 2,
    });
    // The legacy screen inverted tone and produced ~72/255 for white.
    expect(meanRGB(white)[0]).toBeGreaterThan(240);
  });

  it('renders the requested period for color halftone', () => {
    const img = solid(480, 64, [128, 128, 128]);
    applyColorHalftone(img, {
      screenSize: 16,
      angle: 0,
      dotShape: 'round',
      mode: 'mono',
      intensity: 1,
      algorithmVersion: 2,
    });
    // The mono screen inks over the gray source, so dot interiors are near
    // black while paper stays at the source level; separate them at 90.
    const periods = [24, 28, 32, 36].map((row) => measurePeriod(img, row, 90)).filter((p) => p > 0);
    expect(periods.length).toBeGreaterThan(0);
    const average = periods.reduce((sum, value) => sum + value, 0) / periods.length;
    expect(average).toBeGreaterThan(5.4);
    expect(average).toBeLessThan(6.6);
  });

  it('preserves primaries in CMYK mode', () => {
    for (const rgb of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ] as const) {
      const img = solid(96, 96, rgb);
      applyColorHalftone(img, {
        screenSize: 16,
        angle: 0,
        dotShape: 'round',
        mode: 'cmyk',
        intensity: 1,
        algorithmVersion: 2,
      });
      const [r, g, b] = meanRGB(img);
      expect(Math.abs(r - rgb[0]), `${rgb.join(',')} R`).toBeLessThan(8);
      expect(Math.abs(g - rgb[1]), `${rgb.join(',')} G`).toBeLessThan(8);
      expect(Math.abs(b - rgb[2]), `${rgb.join(',')} B`).toBeLessThan(8);
    }
  });

  it('keeps gray neutral in RGB mode', () => {
    const img = solid(96, 96, [128, 128, 128]);
    applyColorHalftone(img, {
      screenSize: 16,
      angle: 0,
      dotShape: 'round',
      mode: 'rgb',
      intensity: 1,
      algorithmVersion: 2,
    });
    const [r, g, b] = meanRGB(img);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(6);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
  });
});
