import { describe, expect, it } from 'vitest';
import type { FilterIR } from '../types';
import { applyLutToImageData } from './apply';
import { bakeFiltersToLut } from './bake';
import { exportLutToCube } from './exportCube';
import {
  applyLut1D,
  sampleLut1D,
  sampleLut3D,
  sampleLut3DTetrahedral,
  sampleLut3DTrilinear,
} from './interpolate';
import { Parse3dlError, parse3dlData } from './parse3dl';
import { CubeParseError, parseCubeData } from './parseCube';
import { makeIdentityLut1D, makeIdentityLut3D } from './types';

// ─── Identity LUTs ─────────────────────────────────────────────

describe('makeIdentityLut3D', () => {
  it('creates a 17^3 identity LUT', () => {
    const lut = makeIdentityLut3D(17);
    expect(lut.kind).toBe('3d');
    expect(lut.size).toBe(17);
    expect(lut.data.length).toBe(17 * 17 * 17 * 3);
    // Check corner values
    const idx = (r: number, g: number, b: number) => ((b * 17 + g) * 17 + r) * 3;
    // (0,0,0) → black
    expect(lut.data[idx(0, 0, 0)]).toBe(0);
    expect(lut.data[idx(0, 0, 0) + 1]).toBe(0);
    expect(lut.data[idx(0, 0, 0) + 2]).toBe(0);
    // (16,16,16) → white
    expect(lut.data[idx(16, 16, 16)]).toBe(1);
    expect(lut.data[idx(16, 16, 16) + 1]).toBe(1);
    expect(lut.data[idx(16, 16, 16) + 2]).toBe(1);
    // Midpoint (8,8,8) → 0.5
    expect(lut.data[idx(8, 8, 8)]).toBeCloseTo(0.5);
    expect(lut.data[idx(8, 8, 8) + 1]).toBeCloseTo(0.5);
    expect(lut.data[idx(8, 8, 8) + 2]).toBeCloseTo(0.5);
  });
});

describe('makeIdentityLut1D', () => {
  it('creates a 256-entry identity 1D LUT', () => {
    const lut = makeIdentityLut1D(256);
    expect(lut.kind).toBe('1d');
    expect(lut.size).toBe(256);
    expect(lut.r[0]).toBe(0);
    expect(lut.r[255]).toBe(1);
    expect(lut.r[128]).toBeCloseTo(128 / 255);
  });
});

// ─── 1D LUT Interpolation ──────────────────────────────────────

describe('sampleLut1D', () => {
  it('returns 0 for input 0 on identity LUT', () => {
    const lut = makeIdentityLut1D(256);
    expect(sampleLut1D(lut, 'r', 0)).toBeCloseTo(0);
    expect(sampleLut1D(lut, 'g', 0)).toBeCloseTo(0);
    expect(sampleLut1D(lut, 'b', 0)).toBeCloseTo(0);
  });

  it('returns 1 for input 1 on identity LUT', () => {
    const lut = makeIdentityLut1D(256);
    expect(sampleLut1D(lut, 'r', 1)).toBeCloseTo(1);
  });

  it('linearly interpolates between entries', () => {
    const lut = makeIdentityLut1D(3); // entries at 0, 0.5, 1
    expect(sampleLut1D(lut, 'r', 0.25)).toBeCloseTo(0.25);
    expect(sampleLut1D(lut, 'r', 0.75)).toBeCloseTo(0.75);
  });

  it('clamps input below domain min', () => {
    const lut = makeIdentityLut1D(256);
    expect(sampleLut1D(lut, 'r', -0.5)).toBe(0);
  });

  it('clamps input above domain max', () => {
    const lut = makeIdentityLut1D(256);
    expect(sampleLut1D(lut, 'r', 1.5)).toBe(1);
  });
});

describe('applyLut1D', () => {
  it('passes through identity values', () => {
    const lut = makeIdentityLut1D(256);
    const result = applyLut1D(lut, [0.2, 0.5, 0.8]);
    expect(result[0]).toBeCloseTo(0.2);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.8);
  });
});

// ─── 3D LUT Interpolation ──────────────────────────────────────

describe('sampleLut3DTrilinear', () => {
  it('returns identity for identity LUT at lattice points', () => {
    const lut = makeIdentityLut3D(17);
    const result = sampleLut3DTrilinear(lut, 0, 0, 0);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(0);

    const result2 = sampleLut3DTrilinear(lut, 1, 1, 1);
    expect(result2[0]).toBeCloseTo(1);
    expect(result2[1]).toBeCloseTo(1);
    expect(result2[2]).toBeCloseTo(1);
  });

  it('interpolates at non-lattice positions', () => {
    const lut = makeIdentityLut3D(3); // 3x3x3 grid
    const result = sampleLut3DTrilinear(lut, 0.25, 0.25, 0.25);
    expect(result[0]).toBeCloseTo(0.25, 1);
    expect(result[1]).toBeCloseTo(0.25, 1);
    expect(result[2]).toBeCloseTo(0.25, 1);
  });
});

describe('sampleLut3DTetrahedral', () => {
  it('matches trilinear at lattice points', () => {
    const lut = makeIdentityLut3D(17);
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const t = sampleLut3DTetrahedral(lut, v, v, v);
      expect(t[0]).toBeCloseTo(v, 1);
      expect(t[1]).toBeCloseTo(v, 1);
      expect(t[2]).toBeCloseTo(v, 1);
    }
  });

  it('produces continuous results at internal points', () => {
    const lut = makeIdentityLut3D(9);
    const r1 = sampleLut3DTetrahedral(lut, 0.3, 0.3, 0.3);
    const r2 = sampleLut3DTetrahedral(lut, 0.31, 0.3, 0.3);
    expect(Math.abs(r1[0] - r2[0])).toBeLessThan(0.02);
  });
});

describe('sampleLut3D', () => {
  it('nearest-neighbour picks closest grid point', () => {
    const lut = makeIdentityLut3D(3);
    const result = sampleLut3D(lut, 0.49, 0.49, 0.49, 'nearest');
    expect(result[0]).toBeCloseTo(0.5, 1);
  });

  it('defaults to tetrahedral', () => {
    const lut = makeIdentityLut3D(17);
    const result = sampleLut3D(lut, 0.5, 0.5, 0.5);
    expect(result[0]).toBeCloseTo(0.5, 1);
  });
});

// ─── LUT Application to ImageData ──────────────────────────────

function makeTestImageData(
  r: number,
  g: number,
  b: number,
  a: number = 255,
  w: number = 4,
  h: number = 4,
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    data[off] = r;
    data[off + 1] = g;
    data[off + 2] = b;
    data[off + 3] = a;
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('applyLutToImageData', () => {
  it('does not modify image when intensity is 0', () => {
    const img = makeTestImageData(100, 150, 200);
    const lut = makeIdentityLut3D(17);
    applyLutToImageData(img, lut, 0);
    expect(img.data[0]).toBe(100);
    expect(img.data[1]).toBe(150);
    expect(img.data[2]).toBe(200);
  });

  it('identity 3D LUT does not change image at full intensity', () => {
    const img = makeTestImageData(100, 150, 200);
    const lut = makeIdentityLut3D(17);
    applyLutToImageData(img, lut, 1);
    expect(img.data[0]).toBe(100);
    expect(img.data[1]).toBe(150);
    expect(img.data[2]).toBe(200);
  });

  it('identity 1D LUT does not change image', () => {
    const img = makeTestImageData(100, 150, 200);
    const lut = makeIdentityLut1D(256);
    applyLutToImageData(img, lut, 1);
    expect(img.data[0]).toBe(100);
    expect(img.data[1]).toBe(150);
    expect(img.data[2]).toBe(200);
  });

  it('preserves alpha channel', () => {
    const img = makeTestImageData(100, 150, 200, 128);
    const lut = makeIdentityLut3D(17);
    applyLutToImageData(img, lut, 1);
    expect(img.data[3]).toBe(128);
  });

  it('blends correctly with partial intensity', () => {
    const img = makeTestImageData(0, 0, 0, 255);
    // Identity LUT with 0.5 intensity: original is black, output is black → still black
    const lut = makeIdentityLut3D(17);
    applyLutToImageData(img, lut, 0.5);
    expect(img.data[0]).toBe(0);
    expect(img.data[1]).toBe(0);
    expect(img.data[2]).toBe(0);
  });
});

// ─── .cube Parser ──────────────────────────────────────────────

describe('parseCubeData', () => {
  const valid3dCube = `TITLE "Test LUT"
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
LUT_3D_SIZE 3
0.0 0.0 0.0
0.5 0.0 0.0
1.0 0.0 0.0
0.0 0.5 0.0
0.5 0.5 0.0
1.0 0.5 0.0
0.0 1.0 0.0
0.5 1.0 0.0
1.0 1.0 0.0
0.0 0.0 0.5
0.5 0.0 0.5
1.0 0.0 0.5
0.0 0.5 0.5
0.5 0.5 0.5
1.0 0.5 0.5
0.0 1.0 0.5
0.5 1.0 0.5
1.0 1.0 0.5
0.0 0.0 1.0
0.5 0.0 1.0
1.0 0.0 1.0
0.0 0.5 1.0
0.5 0.5 1.0
1.0 0.5 1.0
0.0 1.0 1.0
0.5 1.0 1.0
1.0 1.0 1.0
`;

  const valid1dCube = `TITLE "1D Test LUT"
LUT_1D_SIZE 4
0.0
0.33
0.67
1.0
0.0
0.33
0.67
1.0
0.0
0.33
0.67
1.0
`;

  it('parses a valid 3D .cube file', () => {
    const result = parseCubeData(valid3dCube);
    expect(result.transform.kind).toBe('3d');
    if (result.transform.kind === '3d') {
      expect(result.transform.size).toBe(3);
      expect(result.transform.inputMin).toEqual([0, 0, 0]);
      expect(result.transform.inputMax).toEqual([1, 1, 1]);
      expect(result.title).toBe('Test LUT');
    }
  });

  it('parses a valid 1D .cube file', () => {
    const result = parseCubeData(valid1dCube);
    expect(result.transform.kind).toBe('1d');
    if (result.transform.kind === '1d') {
      expect(result.transform.size).toBe(4);
      expect(result.transform.r[0]).toBe(0);
      expect(result.transform.r[3]).toBe(1);
      expect(result.transform.g[0]).toBe(0);
      expect(result.transform.b[0]).toBe(0);
    }
  });

  it('throws on missing LUT_SIZE declaration', () => {
    expect(() => parseCubeData('0.0 0.0 0.0\n0.5 0.5 0.5\n')).toThrow(CubeParseError);
  });

  it('throws on contradictory size declarations', () => {
    expect(() => parseCubeData('LUT_3D_SIZE 3\nLUT_1D_SIZE 3\n0 0 0\n')).toThrow(CubeParseError);
  });

  it('rejects negative LUT size', () => {
    expect(() => parseCubeData('LUT_3D_SIZE -1\n0 0 0\n')).toThrow(CubeParseError);
  });

  it('rejects huge LUT size', () => {
    expect(() => parseCubeData('LUT_3D_SIZE 999\n0 0 0\n')).toThrow(CubeParseError);
  });

  it('handles comments and blank lines', () => {
    const data = `# This is a comment
TITLE "Commented LUT"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
    const result = parseCubeData(data);
    expect(result.transform.kind).toBe('3d');
    if (result.transform.kind === '3d') {
      expect(result.transform.size).toBe(2);
    }
  });

  it('handles Windows line endings', () => {
    const data =
      'LUT_3D_SIZE 2\r\n0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1\r\n';
    const result = parseCubeData(data);
    expect(result.transform.kind).toBe('3d');
  });
});

// ─── .3dl Parser ───────────────────────────────────────────────

describe('parse3dlData', () => {
  const valid3dl = `0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

  it('parses a valid 2^3 .3dl file', () => {
    const result = parse3dlData(valid3dl);
    expect(result.transform.kind).toBe('3d');
    expect(result.transform.size).toBe(2);
  });

  it('throws on empty file', () => {
    expect(() => parse3dlData('')).toThrow(Parse3dlError);
  });

  it('throws on non-cube data count', () => {
    const bad = '0.0 0.0 0.0\n1.0 0.0 0.0\n';
    expect(() => parse3dlData(bad)).toThrow(Parse3dlError);
  });

  it('ignores comments and 3DMESH headers', () => {
    const withComments = `# 3D LUT
3DMESH
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
    const result = parse3dlData(withComments);
    expect(result.transform.size).toBe(2);
  });
});

// ─── .cube Export ──────────────────────────────────────────────

describe('exportLutToCube', () => {
  it('round-trips a 3D LUT through parse → export → parse', () => {
    const original = makeIdentityLut3D(9);
    const cubeText = exportLutToCube(original, { title: 'Identity 9' });
    const result = parseCubeData(cubeText);
    expect(result.transform.kind).toBe('3d');
    if (result.transform.kind === '3d') {
      expect(result.transform.size).toBe(9);
      expect(result.title).toBe('Identity 9');
      // Compare values
      for (let i = 0; i < original.data.length; i++) {
        expect(result.transform.data[i]).toBeCloseTo(original.data[i]!);
      }
    }
  });

  it('includes TITLE and DOMAIN metadata in output', () => {
    const lut = makeIdentityLut3D(17);
    const text = exportLutToCube(lut, {
      title: 'My LUT',
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    });
    expect(text).toContain('TITLE "My LUT"');
    expect(text).toContain('DOMAIN_MIN');
    expect(text).toContain('DOMAIN_MAX');
    expect(text).toContain('LUT_3D_SIZE 17');
  });

  it('exports 1D LUT correctly', () => {
    const lut = makeIdentityLut1D(256);
    const text = exportLutToCube(lut, { title: '1D Identity' });
    expect(text).toContain('LUT_1D_SIZE');
    const result = parseCubeData(text);
    expect(result.transform.kind).toBe('1d');
  });

  it('resamples a 1D LUT instead of repeating source entries', () => {
    const lut = makeIdentityLut1D(3);
    lut.r.set([0, 0.25, 1]);
    const text = exportLutToCube(lut, { size: 5 });
    const result = parseCubeData(text);
    expect(result.transform.kind).toBe('1d');
    if (result.transform.kind === '1d') {
      expect(result.transform.r[2]).toBeCloseTo(0.25, 3);
      expect(result.transform.r[1]).toBeCloseTo(0.125, 3);
    }
  });

  it('flattens a shaper+3D LUT into a semantically equivalent 3D export', () => {
    const shaper = makeIdentityLut1D(3);
    shaper.r.set([0, 0.25, 1]);
    const text = exportLutToCube(
      { kind: 'shaper3d', shaper, lut3d: makeIdentityLut3D(3), metadata: {} },
      { size: 5 },
    );
    const result = parseCubeData(text);
    expect(result.transform.kind).toBe('3d');
    if (result.transform.kind === '3d') {
      expect(result.transform.size).toBe(5);
      expect(result.transform.data[6]).toBeCloseTo(0.25, 3);
    }
  });
});

// ─── 3D Bake Applies Filters ───────────────────────────────────

/**
 * Pixel-store fake surface: fillRect writes `fillStyle` into a real
 * Uint8ClampedArray, getImageData/putImageData round-trip it. Lets the
 * bake loop be exercised in node where the browser canvas is a no-op.
 */
function fakeSurfaceFactory() {
  const store = new Uint8ClampedArray(4);
  let fillStyleValue = 'rgb(0, 0, 0)';
  const parseRgb = (css: string): [number, number, number] => {
    const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(css);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const ctx = {
    canvas: {} as HTMLCanvasElement,
    get fillStyle() {
      return fillStyleValue;
    },
    set fillStyle(v: string) {
      fillStyleValue = v;
    },
    fillRect: (_x: number, _y: number, w: number, h: number) => {
      const [r, g, b] = parseRgb(fillStyleValue);
      for (let i = 0; i < w * h; i++) {
        store[i * 4] = r;
        store[i * 4 + 1] = g;
        store[i * 4 + 2] = b;
        store[i * 4 + 3] = 255;
      }
    },
    getImageData: (_x: number, _y: number, w: number, h: number) =>
      new ImageData(store.slice(0, w * h * 4), w, h),
    putImageData: (img: ImageData) => {
      store.set(img.data);
    },
  };
  return {
    canvas: ctx.canvas,
    context: ctx as unknown as CanvasRenderingContext2D,
    backend: 'html' as const,
  };
}

describe('bakeFiltersToLut 3D applies filters', () => {
  // CurvesAdjustment.points are in 0-255 document/render space
  // (input 128 → output 178 ≈ normalized 0.5 → 0.7).
  const redBoost: FilterIR = {
    kind: 'curves',
    channel: 'red',
    points: [
      { input: 0, output: 0 },
      { input: 128, output: 178 },
      { input: 255, output: 255 },
    ],
    opacity: 1,
    blendMode: 'normal',
  };

  it('samples the filter output, not the identity input', () => {
    const result = bakeFiltersToLut([redBoost], { format: '3d', size: 9 }, fakeSurfaceFactory);
    expect(result.lut.kind).toBe('3d');
    if (result.lut.kind !== '3d') return;
    // Mid-grid sample r=g=b=4/8 → input 0.5,0.5,0.5
    const idx = ((4 * 9 + 4) * 9 + 4) * 3;
    // Red channel: curves input 0.5 → output 0.7 (canvas byte ≈ 178/255)
    expect(result.lut.data[idx]).toBeCloseTo(0.7, 1);
    // Green/blue untouched by the red-curve: stay ≈ 0.5
    expect(result.lut.data[idx + 1]).toBeCloseTo(0.5, 2);
    expect(result.lut.data[idx + 2]).toBeCloseTo(0.5, 2);
  });

  it('unaffected channels are preserved at the grid sample', () => {
    const result = bakeFiltersToLut([redBoost], { format: '3d', size: 9 }, fakeSurfaceFactory);
    expect(result.lut.kind).toBe('3d');
    if (result.lut.kind !== '3d') return;
    // Grid position (0, 4, 4): r=0 → 0; g=b=0.5 unchanged
    const idx = ((4 * 9 + 4) * 9 + 0) * 3;
    expect(result.lut.data[idx]).toBeCloseTo(0, 1);
    expect(result.lut.data[idx + 1]).toBeCloseTo(0.5, 2);
    expect(result.lut.data[idx + 2]).toBeCloseTo(0.5, 2);
  });

  it('honors per-filter opacity while baking', () => {
    const result = bakeFiltersToLut(
      [
        {
          ...redBoost,
          opacity: 0.5,
        },
      ],
      { format: '3d', size: 9 },
      fakeSurfaceFactory,
    );
    expect(result.lut.kind).toBe('3d');
    if (result.lut.kind !== '3d') return;
    const idx = ((4 * 9 + 4) * 9 + 4) * 3;
    expect(result.lut.data[idx]).toBeCloseTo((0.5 + 0.7) / 2, 1);
  });

  it('rejects non-normal blend filters instead of baking the wrong transform', () => {
    const result = bakeFiltersToLut(
      [{ ...redBoost, blendMode: 'multiply' }],
      { format: '3d', size: 3 },
      fakeSurfaceFactory,
    );
    expect(result.incompatibleFilters).toHaveLength(1);
    expect(result.lut.kind).toBe('3d');
    if (result.lut.kind !== '3d') return;
    const idx = ((1 * 3 + 1) * 3 + 1) * 3;
    expect(result.lut.data[idx]).toBeCloseTo(0.5, 2);
  });
});

// ─── 1D Bake Per-Channel ────────────────────────────────────────

describe('bakeFiltersToLut 1D per-channel', () => {
  it('1D bake produces per-channel curves (not identical R/G/B)', () => {
    const redBoost: FilterIR = {
      kind: 'curves',
      channel: 'red',
      points: [
        { input: 0, output: 0 },
        { input: 128, output: 178 },
        { input: 255, output: 255 },
      ],
      opacity: 1,
      blendMode: 'normal',
    };
    const result = bakeFiltersToLut([redBoost], { format: '1d', size: 5 }, fakeSurfaceFactory);
    expect(result.lut.kind).toBe('1d');
    if (result.lut.kind === '1d') {
      // Core fix: channels must be independent Float64Arrays, not aliased to r
      expect(result.lut.r).not.toBe(result.lut.g);
      expect(result.lut.r).not.toBe(result.lut.b);
      expect(result.lut.g).not.toBe(result.lut.b);
      // Each channel has the correct length
      expect(result.lut.r.length).toBe(5);
      expect(result.lut.g.length).toBe(5);
      expect(result.lut.b.length).toBe(5);
      // The red channel reflects the boost at mid-input (0.5 → ≈0.7);
      // green/blue remain identity.
      expect(result.lut.r[2]).toBeCloseTo(0.7, 1);
      expect(result.lut.g[2]).toBeCloseTo(0.5, 2);
      expect(result.lut.b[2]).toBeCloseTo(0.5, 2);
    }
  });

  it('identity filters produce identical per-channel values', () => {
    const result = bakeFiltersToLut([], { format: '1d', size: 5 });
    expect(result.lut.kind).toBe('1d');
    if (result.lut.kind === '1d') {
      // No filters → identity LUT returned (separate arrays)
      expect(result.lut.r).not.toBe(result.lut.g);
      expect(result.lut.r).not.toBe(result.lut.b);
      expect(result.lut.g).not.toBe(result.lut.b);
      // Identity: endpoints and midpoint
      expect(result.lut.r[0]).toBeCloseTo(0);
      expect(result.lut.r[4]).toBeCloseTo(1);
      expect(result.lut.g[2]).toBeCloseTo(0.5);
      expect(result.lut.b[2]).toBeCloseTo(0.5);
    }
  });
});
