import { BUILTIN_PRESET_GROUPS } from '@varve/shared';
import { describe, expect, it } from 'vitest';

const MM_PER_INCH = 25.4;
const CSS_DPI = 96;
function toPx(w: number, h: number, unit: string): [number, number] {
  if (unit === 'mm')
    return [Math.round((w / MM_PER_INCH) * CSS_DPI), Math.round((h / MM_PER_INCH) * CSS_DPI)];
  if (unit === 'in') return [Math.round(w * CSS_DPI), Math.round(h * CSS_DPI)];
  return [Math.round(w), Math.round(h)];
}

describe('page size preset conversion', () => {
  it('converts A4 to the standard 96dpi pixel size', () => {
    const a4 = BUILTIN_PRESET_GROUPS.flatMap((g) => g.presets).find((p) => p.id === 'a4');
    expect(a4).toBeTruthy();
    expect(toPx(a4!.width, a4!.height, a4!.unit)).toEqual([794, 1123]);
  });

  it('leaves px presets untouched', () => {
    expect(toPx(1920, 1080, 'px')).toEqual([1920, 1080]);
  });

  it('produces a usable size for every builtin preset', () => {
    for (const g of BUILTIN_PRESET_GROUPS) {
      for (const p of g.presets) {
        const [w, h] = toPx(p.width, p.height, p.unit);
        expect(w, `${p.id} width`).toBeGreaterThan(0);
        expect(h, `${p.id} height`).toBeGreaterThan(0);
      }
    }
  });
});
