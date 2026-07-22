import { describe, expect, it } from 'vitest';
import {
  backdropChangedSinceLastResolve,
  getTargetRatio,
  resolveAdaptiveTextColor,
  sampleRegionBackdrop,
} from './adaptiveContrast';

describe('getTargetRatio', () => {
  it('returns 4.5 for WCAG AA normal text', () => {
    expect(getTargetRatio('wcag-aa', undefined, false)).toBe(4.5);
  });

  it('returns 3.0 for WCAG AA large text', () => {
    expect(getTargetRatio('wcag-aa', undefined, true)).toBe(3.0);
  });

  it('returns 7.0 for WCAG AAA normal text', () => {
    expect(getTargetRatio('wcag-aaa', undefined, false)).toBe(7.0);
  });

  it('returns 4.5 for WCAG AAA large text', () => {
    expect(getTargetRatio('wcag-aaa', undefined, true)).toBe(4.5);
  });

  it('returns custom ratio clamped to valid range', () => {
    expect(getTargetRatio('custom', 2, false)).toBe(4.5);
    expect(getTargetRatio('custom', 7, false)).toBe(7);
    expect(getTargetRatio('custom', 25, false)).toBe(21);
    expect(getTargetRatio('custom', 4.5, false)).toBe(4.5);
  });
});

describe('resolveAdaptiveTextColor', () => {
  const whiteBg: [number, number, number] = [255, 255, 255];
  const darkGrayBg: [number, number, number] = [100, 100, 100];
  const blackFill: [number, number, number, number] = [0, 0, 0, 255];
  const _whiteFill: [number, number, number, number] = [255, 255, 255, 255];
  const _redFill: [number, number, number, number] = [200, 50, 50, 255];

  it('returns null when contrast already meets target', () => {
    const result = resolveAdaptiveTextColor(
      blackFill,
      whiteBg,
      { enabled: true, policy: 'wcag-aa' },
      16,
    );
    expect(result).toBeNull();
  });

  it('returns null for transparent fill', () => {
    const result = resolveAdaptiveTextColor(
      [0, 0, 0, 0],
      whiteBg,
      { enabled: true, policy: 'wcag-aa' },
      16,
    );
    expect(result).toBeNull();
  });

  it('uses darkColor candidate when available', () => {
    const result = resolveAdaptiveTextColor(
      [200, 200, 200, 255],
      whiteBg,
      { enabled: true, policy: 'wcag-aa', darkColor: [0, 0, 0, 255] },
      16,
    );
    expect(result).not.toBeNull();
    expect(result!.resolved[0]).toBe(0);
    expect(result!.resolved[1]).toBe(0);
    expect(result!.resolved[2]).toBe(0);
  });

  it('uses lightColor candidate when dark fails', () => {
    const result = resolveAdaptiveTextColor(
      [50, 50, 50, 255],
      darkGrayBg,
      {
        enabled: true,
        policy: 'wcag-aa',
        darkColor: [0, 0, 0, 255],
        lightColor: [255, 255, 255, 255],
      },
      16,
    );
    expect(result).not.toBeNull();
  });

  it('falls back to autoFixContrast when no candidates provided', () => {
    const result = resolveAdaptiveTextColor(
      [180, 100, 100, 255],
      whiteBg,
      { enabled: true, policy: 'wcag-aa' },
      16,
    );
    expect(result).not.toBeNull();
    expect(result!.meetsTarget).toBe(true);
    expect(result!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('uses AAA threshold when policy is wcag-aaa', () => {
    const result = resolveAdaptiveTextColor(
      [120, 120, 120, 255],
      whiteBg,
      { enabled: true, policy: 'wcag-aaa' },
      16,
    );
    expect(result).not.toBeNull();
    expect(result!.meetsTarget).toBe(true);
    expect(result!.ratio).toBeGreaterThanOrEqual(7);
  });

  it('uses custom ratio when policy is custom', () => {
    const result = resolveAdaptiveTextColor(
      [120, 120, 120, 255],
      whiteBg,
      { enabled: true, policy: 'custom', customRatio: 10 },
      16,
    );
    expect(result).not.toBeNull();
    expect(result!.meetsTarget).toBe(true);
    expect(result!.ratio).toBeGreaterThanOrEqual(10);
  });
});

describe('sampleRegionBackdrop', () => {
  it('returns null for zero dimensions', () => {
    expect(sampleRegionBackdrop(0, 100, () => {})).toBeNull();
    expect(sampleRegionBackdrop(100, 0, () => {})).toBeNull();
  });

  it('returns null when OffscreenCanvas is unavailable', () => {
    const orig = (globalThis as Record<string, unknown>).OffscreenCanvas;
    (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
    const result = sampleRegionBackdrop(10, 10, () => {});
    (globalThis as Record<string, unknown>).OffscreenCanvas = orig;
    expect(result).toBeNull();
  });
});

describe('backdropChangedSinceLastResolve', () => {
  it('returns true when change exceeds hysteresis', () => {
    const changed = backdropChangedSinceLastResolve([255, 255, 255], [0, 0, 0, 255], 0.5);
    expect(changed).toBe(true);
  });

  it('returns false when change is within hysteresis', () => {
    const changed = backdropChangedSinceLastResolve([255, 255, 255], [250, 250, 250, 255], 0.5);
    expect(changed).toBe(false);
  });

  it('uses default hysteresis when not provided', () => {
    const changed = backdropChangedSinceLastResolve([255, 255, 255], [0, 0, 0, 255]);
    expect(changed).toBe(true);
  });
});
