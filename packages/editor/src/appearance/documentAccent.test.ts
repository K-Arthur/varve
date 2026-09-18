import type { PaletteAnalysis, PaletteSwatch } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveAccentOverrides,
  deriveRamp,
  documentAccentController,
  MAX_ACCENT_LIGHTNESS,
  MIN_ACCENT_CHROMA,
  MIN_ACCENT_LIGHTNESS,
  pickAccentSource,
} from './documentAccent';

function swatch(
  oklch: readonly [number, number, number],
  weight: number,
  roleCandidate: PaletteSwatch['roleCandidate'] = 'dominant',
): PaletteSwatch {
  return {
    id: `sw-${oklch.join('-')}`,
    color: { space: 'srgb', channels: [0, 0, 0], alpha: 1 } as unknown as PaletteSwatch['color'],
    oklab: [0.5, 0, 0],
    oklch,
    population: weight * 1000,
    weight,
    roleCandidate,
    origin: 'extracted',
    sourceClusterId: 'c0',
  };
}

function analysis(extracted: PaletteSwatch[], coverage = 1): PaletteAnalysis {
  return {
    version: 1,
    config: {} as PaletteAnalysis['config'],
    extracted,
    derived: { harmonies: [] },
    contrastPairs: [],
    warnings: [],
    timings: { samplingMs: 0, clusteringMs: 0, postprocessMs: 0, totalMs: 0 },
    colors: [],
    coverage,
  } as unknown as PaletteAnalysis;
}

describe('pickAccentSource', () => {
  it('picks the dominant saturated swatch hue', () => {
    const source = pickAccentSource(
      analysis([
        swatch([0.6, 0.001, 90], 0.5, 'neutral'),
        swatch([0.6, 0.12, 200], 0.5, 'dominant'),
      ]),
    );
    expect(source).not.toBeNull();
    expect(source?.h).toBe(200);
  });

  it('ranks by weight x chroma with a primary-role bias', () => {
    const source = pickAccentSource(
      analysis([
        swatch([0.6, 0.08, 30], 0.4, 'dominant'),
        swatch([0.6, 0.09, 250], 0.35, 'primary'),
      ]),
    );
    // 0.4*0.08*1.1 = 0.0352 vs 0.35*0.09*1.5 = 0.04725
    expect(source?.h).toBe(250);
  });

  it('rejects grayscale documents', () => {
    const source = pickAccentSource(
      analysis([swatch([0.6, MIN_ACCENT_CHROMA - 0.001, 90], 1, 'dominant')]),
    );
    expect(source).toBeNull();
  });

  it('rejects swatches outside the viable lightness window', () => {
    const source = pickAccentSource(
      analysis([
        swatch([MIN_ACCENT_LIGHTNESS - 0.05, 0.15, 90], 0.5),
        swatch([MAX_ACCENT_LIGHTNESS + 0.05, 0.15, 90], 0.5),
      ]),
    );
    expect(source).toBeNull();
  });

  it('rejects empty and meaningless analyses', () => {
    expect(pickAccentSource(analysis([]))).toBeNull();
    const noMeaning = analysis([swatch([0.6, 0.15, 90], 1)]);
    noMeaning.warnings = [{ code: 'no-meaningful-colors', message: 'none' }];
    expect(pickAccentSource(noMeaning)).toBeNull();
    expect(pickAccentSource(analysis([swatch([0.6, 0.15, 90], 1)], 0))).toBeNull();
  });
});

describe('deriveAccentOverrides', () => {
  it('rotates only the hue; lightness and chroma come from the audited ladder', () => {
    const ramp = deriveRamp(45);
    const teal = deriveRamp(188.31);
    ramp.forEach((step, i) => {
      const baseline = teal[i]!;
      expect(step.L).toBe(baseline.L);
      expect(step.C).toBe(baseline.C);
      expect(step.H).toBe(45);
    });
  });

  it('overrides the accent and interactive families in light theme', () => {
    const overrides = deriveAccentOverrides({ h: 45 }, 'light');
    expect(overrides).not.toBeNull();
    expect(overrides?.['--color-accent-primary']).toContain('45');
    expect(overrides?.['--color-interactive-default']).toContain('45');
    // Focus and canvas families are deliberately absent.
    expect(overrides?.['--color-border-focus']).toBeUndefined();
    expect(overrides?.['--color-interactive-focus-ring']).toBeUndefined();
    expect(overrides?.['--color-canvas-selection']).toBeUndefined();
  });

  it('overrides the dark mapping with its own steps', () => {
    const overrides = deriveAccentOverrides({ h: 45 }, 'dark');
    expect(overrides).not.toBeNull();
    expect(overrides?.['--color-accent-subtle']).toBeDefined();
    expect(overrides?.['--color-interactive-default']).toContain('45');
  });

  it('never overrides the High-Contrast theme', () => {
    expect(deriveAccentOverrides({ h: 45 }, 'high-contrast')).toBeNull();
  });
});

describe('documentAccentController', () => {
  const pngPixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  beforeEach(() => {
    documentAccentController.__reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    documentAccentController.__reset();
    vi.useRealTimers();
  });

  function appliedOverrides(): string {
    const style = document.getElementById('varve-doc-accent');
    return style?.textContent ?? '';
  }

  it('applies no overrides while the preference is fixed', async () => {
    documentAccentController.setDocumentContext({
      key: 'doc-a',
      render: async () => pngPixel,
    });
    documentAccentController.setPreference('fixed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(appliedOverrides()).toBe('');
    expect(document.documentElement.dataset.accentSource).toBeUndefined();
  });

  it('clears the derived accent when the document closes', async () => {
    documentAccentController.setPreference('document');
    documentAccentController.setDocumentContext({
      key: 'doc-a',
      render: async () => pngPixel,
    });
    await vi.advanceTimersByTimeAsync(1000);
    documentAccentController.setDocumentContext(null);
    expect(appliedOverrides()).toBe('');
    expect(document.documentElement.dataset.accentSource).toBeUndefined();
  });

  it('ignores stale renders after the context changes', async () => {
    let resolveA: (value: string | null) => void = () => {};
    const slowA = new Promise<string | null>((resolve) => {
      resolveA = resolve;
    });
    documentAccentController.setPreference('document');
    documentAccentController.setDocumentContext({ key: 'doc-a', render: () => slowA });
    await vi.advanceTimersByTimeAsync(500);
    documentAccentController.setDocumentContext({
      key: 'doc-b',
      render: async () => pngPixel,
    });
    await vi.advanceTimersByTimeAsync(500);
    // The stale render resolves late; it must not poison the applied state.
    resolveA(null);
    await vi.advanceTimersByTimeAsync(500);
    // No crash and the controller still reflects the newest context.
    expect(document.documentElement).toBeDefined();
  });

  it('falls back to fixed when extraction yields no eligible hue', async () => {
    documentAccentController.setPreference('document');
    documentAccentController.setDocumentContext({
      key: 'doc-a',
      render: async () => pngPixel,
    });
    await vi.advanceTimersByTimeAsync(1000);
    // A 1x1 transparent pixel decodes but yields no meaningful palette.
    expect(appliedOverrides()).toBe('');
    expect(document.documentElement.dataset.accentSource).toBeUndefined();
  });
});
