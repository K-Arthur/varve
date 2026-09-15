import { describe, expect, it } from 'vitest';
import { applyFilterWithCompositing } from './filterCompositor';
import { isIdentityFilter, withoutIdentityFilters } from './filterIdentity';
import type { FilterIR } from './types';

const base = { opacity: 1, blendMode: 'normal' } as const;

function exposure(value: number, offset = 0, gammaCorrection = 1): FilterIR {
  return { kind: 'exposure', value, offset, gammaCorrection, ...base };
}

describe('isIdentityFilter', () => {
  it('treats neutral tone controls as identity', () => {
    expect(isIdentityFilter(exposure(0))).toBe(true);
    expect(isIdentityFilter({ kind: 'brightness', value: 0, ...base })).toBe(true);
    expect(isIdentityFilter({ kind: 'contrast', value: 0, ...base })).toBe(true);
    expect(isIdentityFilter({ kind: 'saturation', value: 0, ...base })).toBe(true);
    expect(isIdentityFilter({ kind: 'blur', radius: 0, ...base })).toBe(true);
    expect(
      isIdentityFilter({
        kind: 'levels',
        inputShadows: 0,
        inputMidtones: 1,
        inputHighlights: 255,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
        ...base,
      }),
    ).toBe(true);
  });

  it('keeps non-neutral parameters active', () => {
    expect(isIdentityFilter(exposure(1))).toBe(false);
    expect(isIdentityFilter(exposure(0, 0.1))).toBe(false);
    expect(isIdentityFilter(exposure(0, 0, 1.1))).toBe(false);
    expect(
      isIdentityFilter({
        kind: 'levels',
        inputShadows: 4,
        inputMidtones: 1,
        inputHighlights: 255,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
        ...base,
      }),
    ).toBe(false);
  });

  it('never skips a neutral entry under a non-normal blend or reduced opacity', () => {
    expect(
      isIdentityFilter({
        kind: 'exposure',
        value: 0,
        offset: 0,
        gammaCorrection: 1,
        opacity: 0.5,
        blendMode: 'normal',
      }),
    ).toBe(false);
    expect(
      isIdentityFilter({
        kind: 'exposure',
        value: 0,
        offset: 0,
        gammaCorrection: 1,
        opacity: 1,
        blendMode: 'multiply',
      }),
    ).toBe(false);
  });

  it('leaves kinds without a provable neutral on the compositing path', () => {
    expect(
      isIdentityFilter({
        kind: 'curves',
        channel: 'rgb',
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 255 },
        ],
        ...base,
      } as FilterIR),
    ).toBe(false);
  });

  it('drops only the neutral entries from a chain', () => {
    const active = withoutIdentityFilters([exposure(0), exposure(1)]);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: 'exposure', value: 1 });
  });
});

describe('applyFilterWithCompositing identity short-circuit', () => {
  it('does not touch the target when every entry is neutral', () => {
    const target = new Proxy({} as CanvasRenderingContext2D, {
      get() {
        throw new Error('target touched');
      },
    });
    expect(() => applyFilterWithCompositing(target, [exposure(0)], 8, 8)).not.toThrow();
  });

  it('still processes a non-neutral entry', () => {
    const target = new Proxy({} as CanvasRenderingContext2D, {
      get() {
        throw new Error('target touched');
      },
    });
    expect(() => applyFilterWithCompositing(target, [exposure(1)], 8, 8)).toThrow();
  });
});
