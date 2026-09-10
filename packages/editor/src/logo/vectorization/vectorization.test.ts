/**
 * Unit tests for the logo vectorization module: settings validation and
 * presets, source preparation ops, and the preview session stale/cancel guard.
 */
import { describe, expect, it } from 'vitest';
import {
  boxBlur,
  brightness,
  contrast,
  grayscale,
  invert,
  prepareImageData,
  threshold,
} from './prepareSource';
import { scaleSourcePixelTraceOptions } from './preview';
import { traceDiagnostics, VectorizationSession } from './session';
import {
  applyPreset,
  DEFAULT_VECTORIZATION_SETTINGS,
  getVectorizationPreset,
  hashVectorizationSettings,
  toTraceOptions,
  VECTORIZATION_PRESETS,
  type VectorizationSettings,
  validateVectorizationSettings,
} from './settings';

function sampleImageData(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const v = ((i * 7) % 256) as number;
    data[i * 4] = v;
    data[i * 4 + 1] = (i * 3) % 256;
    data[i * 4 + 2] = (i * 5) % 256;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, size, size);
}

describe('vectorization settings', () => {
  it('valid settings produce no warnings', () => {
    const validation = validateVectorizationSettings(DEFAULT_VECTORIZATION_SETTINGS);
    expect(validation.ok).toBe(true);
    expect(validation.warnings).toHaveLength(0);
  });

  it('flags out-of-range values', () => {
    const bad: VectorizationSettings = {
      ...DEFAULT_VECTORIZATION_SETTINGS,
      threshold: 300,
      minArea: -1,
      maxColors: 100,
      prep: { ...DEFAULT_VECTORIZATION_SETTINGS.prep, contrast: 0.1, brightness: 500, denoise: 9 },
    };
    const validation = validateVectorizationSettings(bad);
    expect(validation.ok).toBe(false);
    expect(validation.warnings.length).toBeGreaterThanOrEqual(6);
  });

  it('maps settings onto engine trace options', () => {
    const options = toTraceOptions({
      ...DEFAULT_VECTORIZATION_SETTINGS,
      mode: 'color',
      traceMode: 'centerline',
      threshold: 140,
      maxColors: 12,
    });
    expect(options.mode).toBe('color');
    expect(options.traceMode).toBe('centerline');
    expect(options.threshold).toBe(140);
    expect(options.maxColors).toBe(12);
    expect(options.compoundHoles).toBe(true);
  });

  it('settings hash is stable for identical settings', () => {
    const a = hashVectorizationSettings(DEFAULT_VECTORIZATION_SETTINGS);
    const b = hashVectorizationSettings({ ...DEFAULT_VECTORIZATION_SETTINGS });
    expect(a).toBe(b);
  });

  it('presets exist and apply onto editable settings', () => {
    expect(VECTORIZATION_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of VECTORIZATION_PRESETS) {
      const applied = applyPreset(DEFAULT_VECTORIZATION_SETTINGS, preset);
      expect(applied.presetId).toBe(preset.id);
      expect(applied.threshold).toBe(preset.settings.threshold);
    }
    expect(getVectorizationPreset('nope')).toBeNull();
  });
});

describe('source preparation', () => {
  it('grayscale preserves alpha and equalizes channels', () => {
    const input = sampleImageData(4);
    input.data[0] = 255;
    input.data[1] = 0;
    input.data[2] = 0;
    const out = grayscale(input);
    expect(out.data[0] as number).toBe(out.data[1] as number);
    expect(out.data[1] as number).toBe(out.data[2] as number);
    expect(out.data[3] as number).toBe(input.data[3] as number);
  });

  it('invert complements channels but not alpha', () => {
    const input = sampleImageData(4);
    const out = invert(input);
    expect(out.data[0] as number).toBe(255 - (input.data[0] as number));
    expect(out.data[3] as number).toBe(input.data[3] as number);
  });

  it('contrast clamps to byte range', () => {
    const input = sampleImageData(4);
    input.data[0] = 200;
    const out = contrast(input, 3);
    expect(out.data[0] as number).toBe(255);
  });

  it('brightness shifts within range', () => {
    const input = sampleImageData(4);
    const out = brightness(input, 40);
    expect(out.data[0] as number).toBe(Math.min(255, (input.data[0] as number) + 40));
  });

  it('threshold produces binary output', () => {
    const input = sampleImageData(8);
    const out = threshold(input, 128);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 1]).toBe(out.data[i + 2]);
      expect(out.data[i] === 0 || out.data[i] === 255).toBe(true);
    }
  });

  it('box blur with radius 0 is a copy', () => {
    const input = sampleImageData(8);
    const out = boxBlur(input, 0);
    expect(out.data).toEqual(input.data);
  });

  it('prepareImageData is deterministic for the same stack', () => {
    const input = sampleImageData(8);
    const prep = {
      grayscale: true,
      invert: true,
      contrast: 1.2,
      brightness: 10,
      denoise: 1,
      threshold: false,
      ignoreTransparent: true,
    };
    const first = prepareImageData(input, prep);
    const second = prepareImageData(input, prep);
    expect(first.data).toEqual(second.data);
  });
});

describe('trace resolution conversion', () => {
  it('keeps source-pixel cleanup and fitting semantics when tracing a downsampled raster', () => {
    const options = scaleSourcePixelTraceOptions(
      {
        threshold: 128,
        minArea: 64,
        simplifyTolerance: 2,
        maxError: 1,
        centerlineWidth: 4,
        centerlinePrune: 8,
        cornerAngle: 135,
      },
      { width: 8000, height: 4000 },
      { width: 2000, height: 1000 },
    );

    expect(options.threshold).toBe(128);
    expect(options.cornerAngle).toBe(135);
    expect(options.minArea).toBe(4);
    expect(options.simplifyTolerance).toBe(0.5);
    expect(options.maxError).toBe(0.25);
    expect(options.centerlineWidth).toBe(1);
    expect(options.centerlinePrune).toBe(2);
  });

  it('uses the conservative axis after independently rounded downsampling', () => {
    const options = scaleSourcePixelTraceOptions(
      { simplifyTolerance: 1, maxError: 1 },
      { width: 3000, height: 2000 },
      { width: 1000, height: 666 },
    );
    expect(options.simplifyTolerance).toBeCloseTo(0.333, 6);
    expect(options.maxError).toBeCloseTo(0.333, 6);
  });
});

describe('vectorization session', () => {
  it('new request invalidates the previous request', () => {
    const session = new VectorizationSession();
    const first = session.beginRequest();
    const second = session.beginRequest();
    expect(session.isCurrent(first.handle)).toBe(false);
    expect(session.isCurrent(second.handle)).toBe(true);
    session.dispose();
  });

  it('released handle is no longer current after a newer request', () => {
    const session = new VectorizationSession();
    const first = session.beginRequest();
    session.release(first.handle);
    const second = session.beginRequest();
    expect(session.isCurrent(first.handle)).toBe(false);
    expect(session.isCurrent(second.handle)).toBe(true);
    session.dispose();
  });

  it('cancelAll aborts in-flight work and bumps the generation', () => {
    const session = new VectorizationSession();
    const { handle } = session.beginRequest();
    session.cancelAll();
    expect(session.isCurrent(handle)).toBe(false);
  });

  it('dispose permanently invalidates', () => {
    const session = new VectorizationSession();
    const { handle } = session.beginRequest();
    session.dispose();
    expect(session.isDisposed).toBe(true);
    expect(session.isCurrent(handle)).toBe(false);
  });
});

describe('trace diagnostics', () => {
  it('counts paths, points, holes, and complexity', () => {
    const result = {
      paths: [
        { points: [1, 2, 3], holes: [[1]] },
        { points: [4, 5], holes: [] },
      ],
      omittedHoles: 1,
    };
    const diagnostics = traceDiagnostics(result);
    expect(diagnostics.pathCount).toBe(2);
    expect(diagnostics.pointCount).toBe(5);
    expect(diagnostics.holeCount).toBe(1);
    expect(diagnostics.omittedHoles).toBe(1);
    expect(diagnostics.complexity).toBe(10);
  });
});

describe('pixel-art vectorization settings', () => {
  it('includes a pixel-art sprite preset with hard-boundary defaults', () => {
    const preset = getVectorizationPreset('pixel-art-sprite');
    expect(preset).not.toBeNull();
    expect(preset?.settings.mode).toBe('pixel-art');
    expect(preset?.settings.minArea).toBe(1);
    expect(preset?.settings.simplifyTolerance).toBe(0);
    expect(preset?.settings.traceMode).toBe('silhouette');
  });

  it('maps pixel-art mode through to engine trace options', () => {
    const preset = getVectorizationPreset('pixel-art-sprite');
    expect(preset).not.toBeNull();
    const options = toTraceOptions({
      ...DEFAULT_VECTORIZATION_SETTINGS,
      ...preset?.settings,
      presetId: 'pixel-art-sprite',
    });
    expect(options.mode).toBe('pixel-art');
    expect(options.maxColors).toBe(16);
  });

  it('validates pixel-art settings like other modes', () => {
    const settings: VectorizationSettings = {
      ...DEFAULT_VECTORIZATION_SETTINGS,
      mode: 'pixel-art',
      presetId: 'pixel-art-sprite',
    };
    expect(validateVectorizationSettings(settings).ok).toBe(true);
  });
});
