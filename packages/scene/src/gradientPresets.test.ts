import { describe, expect, it } from 'vitest';
import type { GradientColorStop, GradientOpacityStop, GradientPreset } from './gradientPresets';
import {
  applySegmentMidpoint,
  gradientPresetContentHash,
  gradientPresetIdFromHash,
  makeGradientPreset,
  mergeGradientPresets,
  normalizeColorStops,
  normalizeOpacityStops,
  sampleGradientOpacity,
} from './gradientPresets';

const rgb = (r: number, g = r, b = r, a = 255) => ({ space: 'rgb' as const, r, g, b, a });

const stops = (list: Array<Partial<GradientColorStop>>) => normalizeColorStops(list);
const oStops = (list: Array<Partial<GradientOpacityStop>>) => normalizeOpacityStops(list);

describe('normalizeColorStops', () => {
  it('sorts stops by position', () => {
    const out = stops([
      { position: 1, color: rgb(255) },
      { position: 0, color: rgb(0) },
      { position: 0.5, color: rgb(128) },
    ]);
    expect(out.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });

  it('keeps the first stop when positions are duplicated', () => {
    const out = stops([
      { position: 0.5, color: rgb(10) },
      { position: 0.5, color: rgb(200) },
      { position: 0, color: rgb(0) },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.position === 0.5)?.color).toEqual(rgb(10));
  });

  it('clamps out-of-range positions and rejects NaN/infinity', () => {
    const out = stops([
      { position: -1, color: rgb(0) },
      { position: 2, color: rgb(255) },
      { position: Number.NaN, color: rgb(1) },
      { position: Number.POSITIVE_INFINITY, color: rgb(2) },
    ]);
    for (const s of out) expect(s.position).toBeGreaterThanOrEqual(0);
    for (const s of out) expect(s.position).toBeLessThanOrEqual(1);
  });

  it('assigns stable ids when missing and keeps provided ids', () => {
    const a = stops([
      { position: 0, color: rgb(0) },
      { position: 1, color: rgb(255) },
    ]);
    const b = stops([
      { position: 0, color: rgb(0) },
      { position: 1, color: rgb(255) },
    ]);
    expect(a[0]!.id).toBe(b[0]!.id);
    expect(a[1]!.id).toBe(b[1]!.id);
    const withId = stops([{ position: 0, id: 'my-stop', color: rgb(0) }]);
    expect(withId[0]!.id).toBe('my-stop');
  });

  it('preserves midpoints and clamps them', () => {
    const out = stops([
      { position: 0, color: rgb(0), midpoint: 2 },
      { position: 1, color: rgb(255) },
    ]);
    expect(out[0]!.midpoint).toBe(1);
  });
});

describe('normalizeOpacityStops', () => {
  it('sorts, dedupes, and clamps opacity', () => {
    const out = oStops([
      { position: 0.5, opacity: 2 },
      { position: 0, opacity: 0 },
      { position: 0.5, opacity: 0.5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.opacity).toBe(0);
    expect(out.find((s) => s.position === 0.5)?.opacity).toBe(1);
  });
});

describe('applySegmentMidpoint', () => {
  it('is linear at midpoint 0.5', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(applySegmentMidpoint(t, 0.5)).toBeCloseTo(t, 10);
    }
  });
  it('pushes the 50% blend point toward the next stop when < 0.5', () => {
    // midpoint 0.25: half of the color should be reached at t=0.25
    expect(applySegmentMidpoint(0.25, 0.25)).toBeCloseTo(0.5, 10);
    expect(applySegmentMidpoint(0.5, 0.25)).toBeGreaterThan(0.5);
  });
  it('handles extreme midpoints deterministically', () => {
    expect(applySegmentMidpoint(0, 0)).toBe(0);
    expect(applySegmentMidpoint(0.5, 1)).toBe(0);
    expect(applySegmentMidpoint(1, 1)).toBe(1);
  });
});

describe('sampleGradientOpacity', () => {
  const preset = {
    opacityStops: oStops([
      { position: 0, opacity: 1 },
      { position: 1, opacity: 0 },
    ]),
  };

  it('interpolates between stops', () => {
    expect(sampleGradientOpacity(preset, 0)).toBeCloseTo(1, 10);
    expect(sampleGradientOpacity(preset, 0.5)).toBeCloseTo(0.5, 10);
    expect(sampleGradientOpacity(preset, 1)).toBeCloseTo(0, 10);
  });

  it('extrapolates endpoints', () => {
    expect(sampleGradientOpacity(preset, -0.5)).toBe(1);
    expect(sampleGradientOpacity(preset, 1.5)).toBe(0);
  });

  it('handles empty and single stops', () => {
    expect(sampleGradientOpacity({ opacityStops: [] }, 0.5)).toBe(1);
    expect(
      sampleGradientOpacity({ opacityStops: oStops([{ position: 0.5, opacity: 0.4 }]) }, 0.5),
    ).toBe(0.4);
  });
});

describe('makeGradientPreset', () => {
  it('fills defaults and stable id', () => {
    const p = makeGradientPreset({
      name: 'Test',
      colorStops: [
        { position: 0, color: rgb(0) },
        { position: 1, color: rgb(255) },
      ],
    });
    expect(p.kind).toBe('solid');
    expect(p.interpolation).toBe('oklab');
    expect(p.id).toMatch(/^gpreset-/);
    expect(p.colorStops).toHaveLength(2);
    expect(p.opacityStops).toHaveLength(2);
    expect(p.embedded).toBeUndefined();
  });

  it('keeps a provided id', () => {
    const p = makeGradientPreset({ id: 'custom-id', name: 'X', colorStops: [] });
    expect(p.id).toBe('custom-id');
  });

  it('is deterministic for identical input', () => {
    const input = {
      name: 'A',
      colorStops: [
        { position: 0, color: rgb(0) },
        { position: 1, color: rgb(255, 0, 0) },
      ],
      opacityStops: [{ position: 0.25, opacity: 0.5 }],
    };
    const a = makeGradientPreset(input);
    const b = makeGradientPreset(input);
    expect(a).toEqual(b);
    expect(a.id).toBe(b.id);
  });

  it('truncates very long names', () => {
    const p = makeGradientPreset({ name: 'x'.repeat(5000), colorStops: [] });
    expect(p.name).toHaveLength(4096);
  });
});

describe('gradientPresetContentHash', () => {
  it('is stable and content-sensitive', () => {
    const p1 = makeGradientPreset({
      name: 'A',
      colorStops: [
        { position: 0, color: rgb(0) },
        { position: 1, color: rgb(255) },
      ],
    });
    const p2 = makeGradientPreset({ ...p1 });
    const p3 = makeGradientPreset({
      name: 'A',
      colorStops: [
        { position: 0, color: rgb(0) },
        { position: 1, color: rgb(254) },
      ],
    });
    expect(gradientPresetContentHash(p1)).toBe(gradientPresetContentHash(p2));
    expect(gradientPresetContentHash(p1)).not.toBe(gradientPresetContentHash(p3));
  });

  it('ignores ids', () => {
    const p1 = makeGradientPreset({ id: 'one', name: 'A', colorStops: [] });
    const p2 = makeGradientPreset({ id: 'two', name: 'A', colorStops: [] });
    expect(gradientPresetContentHash(p1)).toBe(gradientPresetContentHash(p2));
  });
});

describe('mergeGradientPresets', () => {
  const existing: GradientPreset[] = [
    makeGradientPreset({
      id: 'existing-1',
      name: 'Same',
      colorStops: [
        { position: 0, color: rgb(0) },
        { position: 1, color: rgb(255) },
      ],
    }),
  ];

  it('merges identical content and creates new ones', () => {
    const incoming = [
      makeGradientPreset({
        id: 'incoming-1',
        name: 'Different name, same ramp',
        colorStops: [
          { position: 0, color: rgb(0) },
          { position: 1, color: rgb(255) },
        ],
      }),
      makeGradientPreset({
        id: 'incoming-2',
        name: 'New',
        colorStops: [
          { position: 0, color: rgb(10) },
          { position: 1, color: rgb(255) },
        ],
      }),
    ];
    const { merged, created } = mergeGradientPresets(existing, incoming);
    expect(merged.get('existing-1')).toBe('incoming-1');
    expect(created).toEqual(['incoming-2']);
  });
});

describe('gradientPresetIdFromHash', () => {
  it('prefixes the hash', () => {
    expect(gradientPresetIdFromHash('abc').startsWith('gpreset-')).toBe(true);
  });
});
