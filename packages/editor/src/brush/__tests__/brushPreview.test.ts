// @vitest-environment jsdom

import { defaultBrushPreset } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  BRUSH_PREVIEW_RENDERER_VERSION,
  BrushPreviewCache,
  brushPreviewFingerprint,
  previewStrokePoints,
} from '../brushPreview';

const opts = { width: 64, height: 48 };

describe('brush preview fingerprint', () => {
  it('is stable for an unchanged preset', () => {
    const p = defaultBrushPreset('a', 'A');
    expect(brushPreviewFingerprint(p, opts)).toBe(brushPreviewFingerprint(p, opts));
  });

  it('changes when a visible preset property changes', () => {
    const p = defaultBrushPreset('a', 'A');
    const before = brushPreviewFingerprint(p, opts);
    expect(brushPreviewFingerprint({ ...p, hardness: 0.2 }, opts)).not.toBe(before);
    expect(brushPreviewFingerprint({ ...p, grainId: 'paper' }, opts)).not.toBe(before);
    expect(brushPreviewFingerprint({ ...p, spacing: 0.9 }, opts)).not.toBe(before);
  });

  it('ignores the preset name, which does not affect the image', () => {
    const p = defaultBrushPreset('a', 'A');
    expect(brushPreviewFingerprint({ ...p, name: 'Renamed' }, opts)).toBe(
      brushPreviewFingerprint(p, opts),
    );
  });

  it('changes with preview size and pixel ratio', () => {
    const p = defaultBrushPreset('a', 'A');
    const base = brushPreviewFingerprint(p, opts);
    expect(brushPreviewFingerprint(p, { ...opts, width: 96 })).not.toBe(base);
    expect(brushPreviewFingerprint(p, { ...opts, pixelRatio: 2 })).not.toBe(base);
  });

  it('includes the renderer version so drawing changes invalidate caches', () => {
    const p = defaultBrushPreset('a', 'A');
    expect(brushPreviewFingerprint(p, opts)).toContain(String(BRUSH_PREVIEW_RENDERER_VERSION));
  });

  it('changes when dynamics change', () => {
    const p = defaultBrushPreset('a', 'A');
    const withPressure = {
      ...p,
      dynamics: [
        {
          input: 'pressure' as const,
          target: 'size' as const,
          curve: [0, 0, 1, 1] as const,
          min: 0.1,
          max: 1,
        },
      ],
    };
    expect(brushPreviewFingerprint(withPressure, opts)).not.toBe(brushPreviewFingerprint(p, opts));
  });
});

describe('preview stroke', () => {
  it('ramps pressure up and back down so both tapers are visible', () => {
    const points = previewStrokePoints(64, 48);
    expect(points.length).toBeGreaterThan(10);
    const mid = points[Math.floor(points.length / 2)]!;
    expect(points[0]!.pressure).toBeLessThan(mid.pressure);
    expect(points[points.length - 1]!.pressure).toBeLessThan(mid.pressure);
  });

  it('stays inside the tile', () => {
    const points = previewStrokePoints(64, 48);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(64);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(48);
    }
  });

  it('is identical between calls', () => {
    expect(previewStrokePoints(64, 48)).toEqual(previewStrokePoints(64, 48));
  });
});

describe('preview cache', () => {
  it('misses when the fingerprint changes', () => {
    const cache = new BrushPreviewCache();
    cache.set('a', 'fp1', 'data:image/png;base64,A');
    expect(cache.get('a', 'fp1')).toBe('data:image/png;base64,A');
    expect(cache.get('a', 'fp2')).toBeNull();
  });

  it('evicts least-recently-used entries past its bound', () => {
    const cache = new BrushPreviewCache(2);
    cache.set('a', 'f', 'A');
    cache.set('b', 'f', 'B');
    cache.get('a', 'f'); // 'b' is now the oldest
    cache.set('c', 'f', 'C');
    expect(cache.size).toBe(2);
    expect(cache.get('b', 'f')).toBeNull();
    expect(cache.get('a', 'f')).toBe('A');
  });

  it('can drop a single preset on edit', () => {
    const cache = new BrushPreviewCache();
    cache.set('a', 'f', 'A');
    cache.invalidate('a');
    expect(cache.get('a', 'f')).toBeNull();
  });
});
