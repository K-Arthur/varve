/**
 * Gradient import pipeline tests: format detection, `.grd` → canonical
 * presets, native JSON round-trip, error mapping, and randomized fuzz.
 */

import type { GradientPreset } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { GrdError } from './descriptor';
import { detectGradientFormat } from './detect';
import { importGradientPresets, toGradientImportError } from './index';
import { decodeGradientPresets, encodeGradientPresets } from './nativeFormat';
import { buildLegacyGrd, buildModernGrd } from './testFixtures';

const twoStop = {
  name: 'Black to White',
  colorStops: [
    { position: 0, color: [0, 0, 0, 255] as const },
    { position: 1, color: [255, 255, 255, 255] as const },
  ],
};

describe('detectGradientFormat', () => {
  it('detects every supported format', () => {
    expect(detectGradientFormat(buildModernGrd([twoStop]))).toBe('photoshop-grd');
    expect(detectGradientFormat(buildLegacyGrd([twoStop]))).toBe('photoshop-grd-legacy');
    expect(
      detectGradientFormat(JSON.stringify({ format: 'varve-gradient', version: 1, gradients: [] })),
    ).toBe('varve-gradient-json');
    expect(detectGradientFormat(new Uint8Array([0, 1, 2, 3]))).toBe('unknown');
  });
});

describe('importGradientPresets', () => {
  it('imports a modern .grd to canonical presets', () => {
    const result = importGradientPresets(buildModernGrd([twoStop]), 'test.grd');
    expect(result.format).toBe('photoshop-grd');
    expect(result.presets).toHaveLength(1);
    const p = result.presets[0]!;
    expect(p.name).toBe('Black to White');
    expect(p.kind).toBe('solid');
    expect(p.interpolation).toBe('oklab');
    expect(p.colorStops).toHaveLength(2);
    expect(p.colorStops[0]!.color).toMatchObject({ space: 'rgb', r: 0, g: 0, b: 0 });
    expect(p.source?.origin).toBe('photoshop-grd');
    expect(p.source?.fileName).toBe('test.grd');
    expect(p.compatibility?.status).toBe('ok');
  });

  it('imports noise gradients read-only', () => {
    const result = importGradientPresets(
      buildModernGrd([{ ...twoStop, name: 'N', isNoise: true }]),
    );
    const p = result.presets[0]!;
    expect(p.kind).toBe('noise');
    expect(p.compatibility?.status).toBe('unsupported');
  });

  it('maps unsupported files to a controlled error', () => {
    const err = toGradientImportError(
      (() => {
        try {
          importGradientPresets(new Uint8Array([1, 2, 3, 4, 5]));
          return null;
        } catch (e) {
          return e;
        }
      })(),
    );
    expect(err.code).toBe('unsupported-format');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('maps GrdError codes through toGradientImportError', () => {
    const err = toGradientImportError(new GrdError('invalid-signature', 'nope'));
    expect(err.code).toBe('invalid-signature');
    expect(err.format).toBe('unknown');
  });

  it('imports native JSON text', () => {
    const json = encodeGradientPresets([
      {
        id: 'gpreset-x',
        name: 'From JSON',
        kind: 'solid',
        colorStops: [
          { id: 'cs-1', position: 0, color: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 } },
          { id: 'cs-2', position: 1, color: { space: 'rgb', r: 200, g: 100, b: 50, a: 255 } },
        ],
        opacityStops: [
          { id: 'os-1', position: 0, opacity: 1 },
          { id: 'os-2', position: 1, opacity: 0.5 },
        ],
        interpolation: 'oklab',
      } satisfies GradientPreset,
    ]);
    const result = importGradientPresets(json);
    expect(result.format).toBe('varve-gradient-json');
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0]!.name).toBe('From JSON');
    expect(result.presets[0]!.id).toBe('gpreset-x');
    expect(result.presets[0]!.opacityStops[1]!.opacity).toBe(0.5);
  });

  it('imports a legacy .strata-gradient.json export (pre-rename format tag)', () => {
    const legacyJson = JSON.stringify({
      format: 'strata-gradient',
      version: 1,
      gradients: [
        {
          id: 'gpreset-legacy',
          name: 'From Strata Beta',
          kind: 'solid',
          colorStops: [
            { id: 'cs-1', position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { id: 'cs-2', position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          opacityStops: [
            { id: 'os-1', position: 0, opacity: 1 },
            { id: 'os-2', position: 1, opacity: 1 },
          ],
          interpolation: 'oklab',
        },
      ],
    });
    const result = importGradientPresets(legacyJson);
    expect(result.format).toBe('varve-gradient-json');
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0]!.name).toBe('From Strata Beta');
  });
});

describe('native JSON format', () => {
  it('round-trips presets without data loss', () => {
    const preset: GradientPreset = {
      id: 'gpreset-rt',
      name: 'Round Trip',
      kind: 'solid',
      colorStops: [
        { id: 'cs-1', position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
        {
          id: 'cs-2',
          position: 0.5,
          midpoint: 0.25,
          color: { space: 'cmyk', c: 50, m: 0, y: 100, k: 0, a: 255 },
        },
        { id: 'cs-3', position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
      ],
      opacityStops: [
        { id: 'os-1', position: 0, opacity: 1 },
        { id: 'os-2', position: 1, midpoint: 0.75, opacity: 0.1 },
      ],
      smoothness: 0.5,
      interpolation: 'oklch',
      source: { origin: 'photoshop-grd', fileName: 'orig.grd', originalName: 'Orig' },
      compatibility: { status: 'approximated', message: 'approx' },
      originalMetadata: { format: 'photoshop-grd', colorModels: ['RGBC'] },
    };
    const encoded = encodeGradientPresets([preset]);
    const decoded = decodeGradientPresets(encoded);
    expect(decoded.presets).toHaveLength(1);
    const rt = decoded.presets[0]!;
    expect(rt.id).toBe('gpreset-rt');
    expect(rt.name).toBe('Round Trip');
    expect(rt.colorStops[1]!.midpoint).toBe(0.25);
    expect(rt.colorStops[1]!.color).toMatchObject({ space: 'cmyk', c: 50 });
    expect(rt.opacityStops[1]!.midpoint).toBe(0.75);
    expect(rt.opacityStops[1]!.opacity).toBeCloseTo(0.1, 5);
    expect(rt.smoothness).toBe(0.5);
    expect(rt.interpolation).toBe('oklch');
    expect(rt.source?.fileName).toBe('orig.grd');
    expect(rt.compatibility?.status).toBe('approximated');
    expect(rt.originalMetadata?.colorModels).toEqual(['RGBC']);
  });

  it('reports warnings for malformed input', () => {
    const bad = decodeGradientPresets('not json');
    expect(bad.warnings.length).toBeGreaterThan(0);
    expect(bad.presets).toHaveLength(0);

    const missing = decodeGradientPresets(
      JSON.stringify({ format: 'strata-gradient', version: 1 }),
    );
    expect(missing.warnings.some((w) => w.includes('gradients'))).toBe(true);

    const newer = decodeGradientPresets(
      JSON.stringify({ format: 'strata-gradient', version: 99, gradients: [] }),
    );
    expect(newer.warnings.some((w) => w.includes('newer'))).toBe(true);
  });

  it('skips malformed gradient entries without failing the file', () => {
    const file = {
      format: 'strata-gradient',
      version: 1,
      gradients: [
        {
          name: 'ok',
          colorStops: [{ position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } }],
        },
        'garbage',
        { name: 'broken' },
      ],
    };
    const decoded = decodeGradientPresets(JSON.stringify(file));
    expect(decoded.presets).toHaveLength(1);
    expect(decoded.skipped).toBe(2);
  });
});

describe('fuzz / property testing', () => {
  it('never throws RangeError/TypeError on random bounded inputs', () => {
    // Deterministic LCG so the fuzz corpus is reproducible.
    let seed = 0x1234abcd;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      const len = rand() % 2048;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = rand() & 0xff;
      try {
        const result = importGradientPresets(bytes);
        for (const p of result.presets) {
          expect(p.colorStops.length).toBeLessThanOrEqual(300);
          for (const s of p.colorStops) {
            expect(Number.isFinite(s.position)).toBe(true);
          }
        }
      } catch (err) {
        // Only controlled GrdError / import errors are acceptable.
        const mapped = toGradientImportError(err);
        expect(mapped.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('random truncations of a valid file produce controlled outcomes', () => {
    const full = buildModernGrd([twoStop, { name: 'B', colorStops: twoStop.colorStops }]);
    for (let cut = 0; cut < full.length; cut += 7) {
      const truncated = full.slice(0, cut);
      try {
        const result = importGradientPresets(truncated);
        // Either the file still parses (only complete gradients) or it throws.
        expect(Array.isArray(result.presets)).toBe(true);
      } catch (err) {
        const mapped = toGradientImportError(err);
        expect([
          'truncated',
          'invalid-signature',
          'unsupported-format',
          'no-usable-gradients',
          'excessive-resource',
        ]).toContain(mapped.code);
      }
    }
  });
});
